/**
 * Release gate: does every LIVE community shard satisfy the schema requirements
 * of the pinned API?
 *
 * WHY THIS EXISTS
 * ---------------
 * Community-template migrations are applied per-community-shard, and nothing
 * gated an API pin bump on whether the live shards actually had them. That has
 * now caused two production incidents:
 *
 *   1124_community_job_checkpoints  -> async post publish broken on 25 shards
 *   1127_asset_story_metadata_refs  -> every publish failed with
 *                                      "no such column: story_ip_metadata_uri"
 *
 * ...and left one latent defect: 1126_reward_qualification_outbox is absent on
 * ALL production shards, which would break Study/Karaoke fleet-wide the moment
 * the reward flags are enabled (the outbox INSERT runs inside the attempt's own
 * transaction).
 *
 * The invariant this enforces:
 *
 *   The pinned API may only deploy when every allocated+loaded shard satisfies
 *   its declared schema requirements.
 *
 * TWO REQUIREMENT CLASSES
 * -----------------------
 * - `unconditional`: exercised regardless of feature flags (1124, 1127). Always
 *   required. A missing one blocks the release.
 * - `features`: required only when a flag bundle is enabled (1126 under rewards).
 *   Checked ONLY when the caller passes --features. This is what lets a
 *   feature-enable workflow demand 1126 *before* flipping REWARDS_*, without
 *   forcing us to apply it just to make the release gate green.
 *
 * Strictly READ-ONLY. It never writes to a shard.
 *
 * Deliberately NOT "every historical migration on every configured D1": blank
 * pool databases and known historical drift make that noisy and untrustworthy.
 * Requirements are declared, versioned, and travel with the API commit.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { extractWranglerJson } from "./lib/fleet-d1-migration"
import { partitionQuarantinedBindings } from "./lib/community-shard-quarantine"
import { type Artifacts, artifactCount, expectedArtifacts } from "./community-schema-artifacts"

type Requirements = {
  $comment?: string | string[]
  version: number
  unconditional: string[]
  features?: Record<string, { flags: string[]; migrations: string[]; note?: string }>
  deferred?: Record<string, { rationale: string }>
  /**
   * Migrations the gate cannot attest by schema (triggers, views, drops, data
   * migrations) — checked by ledger checksum ONLY. Each MUST carry a rationale,
   * so "we can't verify this" is a deliberate, reviewed decision, never a silent
   * gap. Keying by migration filename.
   */
  ledger_only?: Record<string, string>
}

const REQUIREMENT_KEYS = new Set(["$comment", "version", "unconditional", "features", "deferred", "ledger_only"])

/** Parse policy as data, not TypeScript wishful thinking. Unknown or overlapping
 * classes are blocking so a plausible-looking manifest field can never be inert. */
export function validateRequirements(value: unknown, source = "requirements manifest"): Requirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: expected a JSON object`)
  }
  const raw = value as Record<string, unknown>
  const unknown = Object.keys(raw).filter((key) => !REQUIREMENT_KEYS.has(key))
  if (unknown.length > 0) throw new Error(`${source}: unknown top-level key(s): ${unknown.join(", ")}`)
  if (raw.version !== 1) throw new Error(`${source}: unsupported version ${String(raw.version)}`)
  if (!Array.isArray(raw.unconditional) || raw.unconditional.some((name) => typeof name !== "string" || !name)) {
    throw new Error(`${source}: unconditional must be an array of migration filenames`)
  }
  const features = raw.features ?? {}
  const deferred = raw.deferred ?? {}
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new Error(`${source}: features must be an object`)
  }
  if (!deferred || typeof deferred !== "object" || Array.isArray(deferred)) {
    throw new Error(`${source}: deferred must be an object`)
  }
  const classes = new Map<string, string>()
  const claim = (migration: string, policyClass: string) => {
    const prior = classes.get(migration)
    if (prior) throw new Error(`${source}: ${migration} overlaps policy classes ${prior} and ${policyClass}`)
    classes.set(migration, policyClass)
  }
  for (const migration of raw.unconditional as string[]) claim(migration, "unconditional")
  for (const [feature, spec] of Object.entries(features as Record<string, any>)) {
    if (!spec || !Array.isArray(spec.flags) || !Array.isArray(spec.migrations)) {
      throw new Error(`${source}: feature ${feature} requires flags and migrations arrays`)
    }
    for (const migration of spec.migrations) {
      if (typeof migration !== "string" || !migration) throw new Error(`${source}: feature ${feature} has an invalid migration`)
      claim(migration, `features.${feature}`)
    }
  }
  for (const [migration, spec] of Object.entries(deferred as Record<string, any>)) {
    if (!spec || typeof spec.rationale !== "string" || !spec.rationale.trim()) {
      throw new Error(`${source}: deferred ${migration} requires a rationale`)
    }
    claim(migration, "deferred")
  }
  return raw as Requirements
}

type ShardStatus =
  | "satisfied"
  | "missing_migration" // ledger absent AND artifacts absent -> the real gap
  | "ledger_missing_artifacts_present" // drift: schema applied, never ledgered
  | "ledger_present_artifacts_missing" // drift: ledger lies
  | "partial_artifacts" // half-applied
  | "checksum_mismatch" // a DIFFERENT migration of that name was applied
  | "schema_not_ready"
  | "missing_from_config"
  | "error"

/** Anything other than `satisfied` fails the gate. Silence is not success. */
const SATISFIED: ShardStatus = "satisfied"

type ShardReport = {
  binding: string
  database_name: string
  status: ShardStatus
  missing: string[]
  detail?: string
}


/**
 * One SELECT that answers, for every required migration i:
 *   l{i} — is it in the ledger at all?
 *   k{i} — is it in the ledger with the checksum the PINNED CORE expects?
 *   a{i} — how many of its schema artifacts actually exist?
 *
 * Ledger and schema are checked independently and on purpose: a ledger row can
 * lie (`ledger_present_artifacts_missing`), and schema can exist unledgered
 * (`ledger_missing_artifacts_present`). Both are drift, and both fail the gate.
 */
export function buildProbe(
  required: string[],
  expected: Map<string, { checksum: string; artifacts: Artifacts }>,
): string {
  const parts: string[] = []
  required.forEach((name, i) => {
    const exp = expected.get(name)!
    parts.push(
      `(SELECT COUNT(*) FROM schema_migrations WHERE migration_name='${name}') AS l${i}`,
      `(SELECT COUNT(*) FROM schema_migrations WHERE migration_name='${name}' AND checksum='${exp.checksum}') AS k${i}`,
    )
    const artifacts = [
      ...exp.artifacts.tables.map(
        (t) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}')`,
      ),
      ...exp.artifacts.columns.map(
        ([t, c]) => `(SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE name='${c}')`,
      ),
      ...exp.artifacts.indexes.map(
        (idx) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${idx}')`,
      ),
    ]
    parts.push(`(${artifacts.length ? artifacts.join(" + ") : "0"}) AS a${i}`)
  })
  return `SELECT ${parts.join(", ")}`
}

type Options = {
  requirements: string
  migrationsDir: string
  wranglerConfig: string
  prod: boolean
  features: string[]
  manifest: string
  quarantineRegistry: string
  concurrency: number
  cwd: string
}

function parseArgs(): Options {
  const argv = process.argv.slice(2)
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i === -1 ? undefined : argv[i + 1]
  }
  const requirements = get("--requirements")
  const wranglerConfig = get("--wrangler-config")
  if (!requirements || !wranglerConfig) {
    console.error(`
Verify that every LIVE community shard satisfies the pinned API's schema requirements.

  bun scripts/community/verify-community-schema-requirements.ts \\
    --requirements <api>/services/api/community-schema-requirements.json \\
    --wrangler-config <api>/services/community-d1-shard/wrangler.jsonc \\
    [--prod] [--features rewards] [--manifest PATH] [--quarantines PATH] [--concurrency N]

READ-ONLY. Exits non-zero unless every allocated+loaded shard is satisfied.
--features adds that feature's migrations to the required set; omit it and those
migrations are NOT required (that is how 1126 stays feature-conditional).
`)
    process.exit(1)
  }
  const prod = argv.includes("--prod")
  const concurrency = Number(get("--concurrency") ?? "10")
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${get("--concurrency")}"`)
  }
  return {
    requirements: resolve(requirements),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    wranglerConfig: resolve(wranglerConfig),
    prod,
    features: (get("--features") ?? "").split(",").map((f) => f.trim()).filter(Boolean),
    manifest: resolve(get("--manifest") ?? `tmp/community-schema-${prod ? "prod" : "staging"}.json`),
    quarantineRegistry: resolve(get("--quarantines") ?? resolve(import.meta.dir, "community-shard-quarantines.json")),
    concurrency,
    cwd: dirname(resolve(wranglerConfig)),
  }
}

async function wranglerJson(o: Options, db: string, sql: string): Promise<any[]> {
  const cmd = [
    "bunx",
    "wrangler@4.100.0",
    "d1",
    "execute",
    db,
    ...(o.prod ? ["--env", "production"] : []),
    "--remote",
    "--json",
    "--command",
    sql,
  ]
  const proc = Bun.spawn(cmd, { cwd: o.cwd, stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  if (proc.exitCode !== 0) throw new Error(`wrangler d1 execute ${db} failed: ${err.trim() || "(no stderr)"}`)
  return extractWranglerJson(out) as any[]
}

/** The pool is authoritative for which shards are LIVE — not a prior artifact. */
async function liveBindings(o: Options): Promise<string[]> {
  const pool = o.prod ? "community-d1-shard-pool-prod" : "community-d1-shard-pool-staging"
  const rows = (
    await wranglerJson(
      o,
      pool,
      "SELECT binding_name FROM d1_pool WHERE community_id IS NOT NULL AND last_loaded_at IS NOT NULL ORDER BY binding_name",
    )
  )[0].results as Array<{ binding_name: string }>
  if (rows.length === 0) {
    throw new Error(`${pool} reported ZERO live shards. That is a broken view of the fleet, not a pass.`)
  }
  return rows.map((r) => r.binding_name)
}

async function main() {
  const o = parseArgs()
  const req = validateRequirements(JSON.parse(await readFile(o.requirements, "utf8")), o.requirements)

  const required = [...req.unconditional]
  const featureRequired: Record<string, string[]> = {}
  for (const f of o.features) {
    const spec = req.features?.[f]
    if (!spec) throw new Error(`--features ${f}: no such feature in ${o.requirements}`)
    featureRequired[f] = spec.migrations
    required.push(...spec.migrations)
  }
  const requiredSet = [...new Set(required)]

  // Filenames + checksums come from the PINNED Core commit — the same source the
  // deployed code was built against.
  const ledgerOnly = req.ledger_only ?? {}
  const expected = new Map<string, { checksum: string; artifacts: Artifacts; ledgerOnly: boolean }>()
  const attestationGaps: string[] = []
  for (const name of requiredSet) {
    const sql = await readFile(resolve(o.migrationsDir, name), "utf8")
    const artifacts = expectedArtifacts(sql)
    const declaredLedgerOnly = name in ledgerOnly

    // A migration the gate cannot fully attest by schema — no checkable artifacts,
    // or DDL it does not recognize (trigger/view/drop/data) — must be an explicit,
    // rationalised manifest decision. Otherwise "artifacts satisfied" would silently
    // mean "we checked nothing and trusted the ledger", which is the whole failure
    // mode this gate exists to remove.
    if (!declaredLedgerOnly && (artifactCount(artifacts) === 0 || artifacts.unrecognized.length > 0)) {
      const why =
        artifactCount(artifacts) === 0
          ? "produces no schema artifacts the gate can verify"
          : `contains DDL the gate cannot attest: ${artifacts.unrecognized.join(", ")}`
      attestationGaps.push(`  ${name}: ${why}`)
    }
    expected.set(name, {
      checksum: createHash("sha256").update(sql).digest("hex"),
      artifacts,
      ledgerOnly: declaredLedgerOnly,
    })
  }
  if (attestationGaps.length > 0) {
    console.error(
      `::error::Requirements manifest ${o.requirements} lists migrations the gate cannot fully attest by schema:\n` +
        `${attestationGaps.join("\n")}\n` +
        `Either extend the artifact deriver, or add each to "ledger_only" with a rationale ` +
        `(the gate will then verify only its ledger checksum, deliberately).`,
    )
    process.exit(2)
  }

  const raw = (await readFile(o.wranglerConfig, "utf8")).replace(/^\s*\/\/.*$/gm, "")
  const cfg = JSON.parse(raw)
  const entries = o.prod ? cfg.env.production.d1_databases : cfg.d1_databases
  const map = new Map<string, string>()
  for (const e of entries) if (e.binding.startsWith("DB_CMTY")) map.set(e.binding, e.database_name)

  const allocatedBindings = await liveBindings(o)
  const partition = await partitionQuarantinedBindings(
    o.quarantineRegistry,
    o.prod ? "production" : "staging",
    allocatedBindings,
    new Set(map.keys()),
  )
  const bindings = partition.live
  if (bindings.length === 0) throw new Error("quarantine policy leaves ZERO live shards; refusing to pass the release gate")
  const reports: ShardReport[] = []
  const targets: Array<{ binding: string; db: string }> = []
  for (const b of bindings) {
    const db = map.get(b)
    if (!db) {
      // A live shard the config does not know about means our config is stale.
      // Skipping it is how 178 shards once went un-migrated. Fail.
      reports.push({
        binding: b,
        database_name: "(absent from shard config)",
        status: "missing_from_config",
        missing: requiredSet,
        detail: `live in the pool but absent from ${o.wranglerConfig} — the config is stale`,
      })
      continue
    }
    targets.push({ binding: b, db })
  }

  // ONE query per shard. A release gate that costs 3 round-trips per shard takes
  // 10+ minutes over 200 shards and will not survive contact with a pipeline.
  const probe = buildProbe(requiredSet, expected)

  let idx = 0
  async function worker() {
    while (idx < targets.length) {
      const { binding, db } = targets[idx++]
      try {
        const row = (await wranglerJson(o, db, probe))[0].results[0] as Record<string, number>
        const missing: string[] = []
        let status: ShardStatus = SATISFIED
        const details: string[] = []

        requiredSet.forEach((name, i) => {
          const exp = expected.get(name)!
          const expectedCount = artifactCount(exp.artifacts)
          const present = Number(row[`a${i}`] ?? 0)
          const all = expectedCount > 0 && present === expectedCount
          const none = present === 0
          const ledgered = Number(row[`l${i}`] ?? 0) === 1
          const checksumOk = Number(row[`k${i}`] ?? 0) === 1

          if (exp.ledgerOnly) {
            // No verifiable schema by manifest decision: the ledger checksum IS the
            // attestation. Still fully checked — just against the ledger alone.
            if (!ledgered) {
              if (status === SATISFIED) status = "missing_migration"
              missing.push(name)
              details.push(`${name}: NOT APPLIED (ledger-only)`)
            } else if (!checksumOk) {
              status = "checksum_mismatch"
              missing.push(name)
              details.push(`${name}: ledger-only, but records a DIFFERENT migration of that name`)
            }
            return
          }

          if (ledgered && !checksumOk) {
            status = "checksum_mismatch"
            missing.push(name)
            details.push(`${name}: ledger records a DIFFERENT migration of that name`)
          } else if (!all && !none) {
            status = "partial_artifacts"
            missing.push(name)
            details.push(`${name}: half-applied (${present}/${expectedCount} artifacts)`)
          } else if (ledgered && none && expectedCount > 0) {
            status = "ledger_present_artifacts_missing"
            missing.push(name)
            details.push(`${name}: ledger says applied but the schema is absent`)
          } else if (!ledgered && all) {
            status = "ledger_missing_artifacts_present"
            missing.push(name)
            details.push(`${name}: schema present but never ledgered`)
          } else if (!ledgered && none) {
            if (status === SATISFIED) status = "missing_migration"
            missing.push(name)
            details.push(`${name}: NOT APPLIED`)
          }
        })
        reports.push({
          binding,
          database_name: db,
          status,
          missing,
          ...(details.length ? { detail: details.join("; ") } : {}),
        })
      } catch (error) {
        reports.push({
          binding,
          database_name: db,
          status: "error",
          missing: requiredSet,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency, Math.max(targets.length, 1)) }, worker))

  const summary: Record<string, number> = {}
  for (const r of reports) summary[r.status] = (summary[r.status] ?? 0) + 1
  const failures = reports.filter((r) => r.status !== SATISFIED)

  await mkdir(dirname(o.manifest), { recursive: true })
  await writeFile(
    o.manifest,
    `${JSON.stringify(
      {
        fleet: o.prod ? "production" : "staging",
        requirements_version: req.version,
        requirements_file: o.requirements,
        shard_config: o.wranglerConfig,
        features_checked: o.features,
        required_migrations: requiredSet,
        feature_migrations: featureRequired,
        allocated_loaded_shards: allocatedBindings.length,
        live_shards: bindings.length,
        quarantined_shards: partition.quarantined.length,
        quarantine_registry: o.quarantineRegistry,
        quarantine_registry_checksum: partition.registryChecksum,
        quarantines: partition.quarantined,
        classified: reports.length,
        summary,
        shards: reports,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`fleet=${o.prod ? "PRODUCTION" : "staging"}  allocated+loaded=${allocatedBindings.length}  live=${bindings.length}  quarantined=${partition.quarantined.length}`)
  console.log(`required (unconditional): ${req.unconditional.join(", ")}`)
  console.log(
    `required (features ${o.features.join(",") || "none"}): ${Object.values(featureRequired).flat().join(", ") || "none"}`,
  )
  console.log(`summary: ${JSON.stringify(summary)}`)
  console.log(`manifest: ${o.manifest}`)

  // Every live shard must be classified. An unclassified shard is not a pass.
  if (reports.length !== bindings.length) {
    console.error(
      `::error::Incomplete classification: ${bindings.length} live shards, ${reports.length} classified.`,
    )
    process.exit(2)
  }

  if (failures.length > 0) {
    console.error(`\n::error::${failures.length} live shard(s) do NOT satisfy the pinned API's schema requirements.`)
    for (const f of failures.slice(0, 20)) {
      console.error(`  ${f.database_name} [${f.binding}]: ${f.status} — ${f.detail ?? f.missing.join(", ")}`)
    }
    if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more (see manifest)`)
    console.error(
      `\nApply the missing community-template migrations to the fleet before this API can deploy.\n` +
        `Do NOT weaken this gate to go green — it exists because 1124 and 1127 each broke production.`,
    )
    process.exit(2)
  }

  console.log(`\nPASS: all ${bindings.length} live shards satisfy the pinned API's schema requirements; ${partition.quarantined.length} explicitly quarantined.`)
}

if (import.meta.main) await main()
