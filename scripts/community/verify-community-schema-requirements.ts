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
import { type Artifacts, expectedArtifacts } from "./community-schema-artifacts"

type Requirements = {
  version: number
  unconditional: string[]
  features?: Record<string, { flags: string[]; migrations: string[]; note?: string }>
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
    [--prod] [--features rewards] [--manifest PATH] [--concurrency N]

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
  const req: Requirements = JSON.parse(await readFile(o.requirements, "utf8"))

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
  const expected = new Map<string, { checksum: string; artifacts: Artifacts }>()
  for (const name of requiredSet) {
    const sql = await readFile(resolve(o.migrationsDir, name), "utf8")
    expected.set(name, {
      checksum: createHash("sha256").update(sql).digest("hex"),
      artifacts: expectedArtifacts(sql),
    })
  }

  const raw = (await readFile(o.wranglerConfig, "utf8")).replace(/^\s*\/\/.*$/gm, "")
  const cfg = JSON.parse(raw)
  const entries = o.prod ? cfg.env.production.d1_databases : cfg.d1_databases
  const map = new Map<string, string>()
  for (const e of entries) if (e.binding.startsWith("DB_CMTY")) map.set(e.binding, e.database_name)

  const bindings = await liveBindings(o)
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
          const artifactCount = exp.artifacts.tables.length + exp.artifacts.columns.length
          const present = Number(row[`a${i}`] ?? 0)
          const all = artifactCount > 0 && present === artifactCount
          const none = present === 0
          const ledgered = Number(row[`l${i}`] ?? 0) === 1
          const checksumOk = Number(row[`k${i}`] ?? 0) === 1

          if (ledgered && !checksumOk) {
            status = "checksum_mismatch"
            missing.push(name)
            details.push(`${name}: ledger records a DIFFERENT migration of that name`)
          } else if (!all && !none) {
            status = "partial_artifacts"
            missing.push(name)
            details.push(`${name}: half-applied (${present}/${artifactCount} artifacts)`)
          } else if (ledgered && none && artifactCount > 0) {
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
        live_shards: bindings.length,
        classified: reports.length,
        summary,
        shards: reports,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`fleet=${o.prod ? "PRODUCTION" : "staging"}  live shards=${bindings.length}`)
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

  console.log(`\nPASS: all ${bindings.length} live shards satisfy the pinned API's schema requirements.`)
}

if (import.meta.main) await main()
