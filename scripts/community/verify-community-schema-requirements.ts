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
import { Database } from "bun:sqlite"
import { mkdir, readFile, readdir } from "node:fs/promises"
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
   * Time-bounded compatibility migrations whose API access is schema-tolerant.
   * They are intentionally neither required nor part of the canonical-schema
   * comparison until their declared promotion condition is satisfied.
   */
  transitional?: Record<string, {
    rationale: string
    promotion_condition: string
    expires_after: string
    owner: string
    tracking_issue: string
    capability_guard: string
    runtime_reference_counts: Record<string, Record<string, number>>
    compatibility_tests: Array<{ path: string; sha256: string }>
  }>
  /**
   * Migrations the gate cannot attest by schema (triggers, views, drops, data
   * migrations) — checked by ledger checksum ONLY. Each MUST carry a rationale,
   * so "we can't verify this" is a deliberate, reviewed decision, never a silent
   * gap. Keying by migration filename.
   */
  ledger_only?: Record<string, string>
  /** Compare every final table/index/column from the pinned Core migration set,
   * excluding migrations explicitly deferred or owned by inactive features. */
  canonical_schema?: boolean
}

const REQUIREMENT_KEYS = new Set([
  "$comment",
  "version",
  "unconditional",
  "features",
  "transitional",
  "deferred",
  "ledger_only",
  "canonical_schema",
])

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
  const transitional = raw.transitional ?? {}
  const deferred = raw.deferred ?? {}
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new Error(`${source}: features must be an object`)
  }
  if (!deferred || typeof deferred !== "object" || Array.isArray(deferred)) {
    throw new Error(`${source}: deferred must be an object`)
  }
  if (!transitional || typeof transitional !== "object" || Array.isArray(transitional)) {
    throw new Error(`${source}: transitional must be an object`)
  }
  if (raw.canonical_schema !== undefined && typeof raw.canonical_schema !== "boolean") {
    throw new Error(`${source}: canonical_schema must be a boolean`)
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
  for (const [migration, spec] of Object.entries(transitional as Record<string, any>)) {
    const requiredText = [
      "rationale",
      "promotion_condition",
      "owner",
      "tracking_issue",
      "capability_guard",
    ] as const
    if (!spec || requiredText.some((key) => typeof spec[key] !== "string" || !spec[key].trim())) {
      throw new Error(`${source}: transitional ${migration} requires complete ownership and promotion metadata`)
    }
    const expiresAt = Date.parse(spec.expires_after)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error(`${source}: transitional ${migration} expires_after must be a future timestamp`)
    }
    if (
      !spec.runtime_reference_counts
      || typeof spec.runtime_reference_counts !== "object"
      || Array.isArray(spec.runtime_reference_counts)
      || Object.keys(spec.runtime_reference_counts).length === 0
    ) {
      throw new Error(`${source}: transitional ${migration} requires runtime_reference_counts`)
    }
    for (const [path, counts] of Object.entries(spec.runtime_reference_counts as Record<string, unknown>)) {
      if (
        !path
        || !counts
        || typeof counts !== "object"
        || Array.isArray(counts)
        || Object.keys(counts).length === 0
        || Object.values(counts).some((count) => !Number.isSafeInteger(count) || Number(count) <= 0)
      ) {
        throw new Error(`${source}: transitional ${migration} has invalid runtime references for ${path || "(empty path)"}`)
      }
    }
    if (
      !Array.isArray(spec.compatibility_tests)
      || spec.compatibility_tests.length === 0
      || spec.compatibility_tests.some((test: any) =>
        !test
        || typeof test.path !== "string"
        || !test.path
        || typeof test.sha256 !== "string"
        || !/^[0-9a-f]{64}$/u.test(test.sha256))
    ) {
      throw new Error(`${source}: transitional ${migration} requires hashed compatibility tests`)
    }
    claim(migration, "transitional")
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
  | "canonical_schema_missing" // final pinned tables/indexes/columns are absent
  | "canonical_schema_regression" // missing canonical artifacts exceed the ratchet baseline
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
  canonical_missing?: string[]
  canonical_regressions?: string[]
  detail?: string
}

type CanonicalSchemaBaseline = {
  version: 1
  fleet: "production" | "staging"
  profiles: Record<string, string[]>
  shards: Record<string, string>
}

export function validateCanonicalSchemaBaseline(
  value: unknown,
  expectedFleet: CanonicalSchemaBaseline["fleet"],
  source = "canonical schema baseline",
): CanonicalSchemaBaseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: must be an object`)
  const raw = value as Record<string, unknown>
  const unknown = Object.keys(raw).filter((key) => !["version", "fleet", "profiles", "shards"].includes(key))
  if (unknown.length) throw new Error(`${source}: unknown top-level key(s): ${unknown.join(", ")}`)
  if (raw.version !== 1) throw new Error(`${source}: version must be 1`)
  if (raw.fleet !== expectedFleet) throw new Error(`${source}: fleet must be ${expectedFleet}`)
  if (!raw.profiles || typeof raw.profiles !== "object" || Array.isArray(raw.profiles)) {
    throw new Error(`${source}: profiles must be an object`)
  }
  for (const [profile, artifacts] of Object.entries(raw.profiles as Record<string, unknown>)) {
    if (!Array.isArray(artifacts) || artifacts.some((artifact) => typeof artifact !== "string" || !artifact)) {
      throw new Error(`${source}: profiles.${profile} must be an array of non-empty strings`)
    }
    if (new Set(artifacts).size !== artifacts.length) throw new Error(`${source}: profiles.${profile} contains duplicates`)
  }
  if (!raw.shards || typeof raw.shards !== "object" || Array.isArray(raw.shards)) {
    throw new Error(`${source}: shards must be an object`)
  }
  const profiles = raw.profiles as Record<string, unknown>
  for (const [binding, profile] of Object.entries(raw.shards as Record<string, unknown>)) {
    if (typeof profile !== "string" || !(profile in profiles)) {
      throw new Error(`${source}: shards.${binding} must name a declared profile`)
    }
  }
  return raw as CanonicalSchemaBaseline
}

export function canonicalSchemaRegressions(
  currentMissing: string[],
  binding: string,
  baseline?: CanonicalSchemaBaseline,
): string[] {
  const profile = baseline?.shards[binding]
  const allowed = new Set(profile ? baseline?.profiles[profile] : [])
  return currentMissing.filter((artifact) => !allowed.has(artifact)).sort()
}

type SchemaArtifactKind = "column" | "index" | "table"
type SchemaObjectRow = { type: "index" | "table"; name: string; sql: string | null }

export const CANONICAL_SCHEMA_INVENTORY_SQL = `
  SELECT type, name, sql
  FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`

function unquoteSqlIdentifier(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("`") && trimmed.endsWith("`"))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1)
  return trimmed
}

function splitCreateTableColumns(sql: string): string[] {
  // sqlite_master preserves comments embedded in CREATE TABLE statements. Strip
  // line comments before splitting, otherwise comment words become fake columns.
  const normalized = sql.replace(/--[^\n]*/gu, "")
  const open = normalized.indexOf("(")
  const close = normalized.lastIndexOf(")")
  if (open < 0 || close <= open) return []
  const body = normalized.slice(open + 1, close)
  const parts: string[] = []
  let current = ""
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    const next = body[index + 1]
    current += char
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          current += next
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char
      continue
    }
    if (char === "[") {
      quote = "]"
      continue
    }
    if (char === "(") depth += 1
    else if (char === ")") depth = Math.max(0, depth - 1)
    else if (char === "," && depth === 0) {
      parts.push(current.slice(0, -1).trim())
      current = ""
    }
  }
  if (current.trim()) parts.push(current.trim())
  const constraint = /^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b)/iu
  return parts
    .filter((part) => !constraint.test(part))
    .map((part) => {
      const match = part.match(/^(?:"(?:""|[^"])+"|`(?:``|[^`])+`|\[[^\]]+\]|[^\s]+)/u)
      return match ? unquoteSqlIdentifier(match[0]) : ""
    })
    .filter(Boolean)
}

export function schemaArtifactsFromRows(rows: SchemaObjectRow[]): Set<string> {
  const artifacts = new Set<string>()
  for (const row of rows) {
    if (row.type === "index") {
      artifacts.add(`index:${row.name}`)
      continue
    }
    artifacts.add(`table:${row.name}`)
    for (const column of splitCreateTableColumns(row.sql ?? "")) {
      artifacts.add(`column:${row.name}.${column}`)
    }
  }
  return artifacts
}

export async function buildCanonicalSchemaArtifacts(input: {
  migrationsDir: string
  excludedMigrations: ReadonlySet<string>
}): Promise<Set<string>> {
  const db = new Database(":memory:")
  try {
    db.exec("PRAGMA foreign_keys = ON")
    db.exec(`CREATE TABLE schema_migrations (
      migration_name TEXT PRIMARY KEY,
      migration_label TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    const files = (await readdir(input.migrationsDir))
      .filter((name) => name.endsWith(".sql") && !input.excludedMigrations.has(name))
      .sort()
    for (const name of files) {
      db.exec(await readFile(resolve(input.migrationsDir, name), "utf8"))
    }
    return schemaArtifactsFromRows(
      db.query<SchemaObjectRow, []>(CANONICAL_SCHEMA_INVENTORY_SQL).all(),
    )
  } finally {
    db.close()
  }
}

type CompatibleMissingSchemaArtifact = {
  artifact: string
  reason: string
}

export function validateCompatibleMissingSchemaArtifacts(
  value: unknown,
  expected: ReadonlySet<string>,
  source: string,
): Set<string> {
  if (!Array.isArray(value)) {
    throw new Error(`${source}: communityTemplate.compatibleMissingSchemaArtifacts must be an array`)
  }
  const allowed = new Set<string>()
  for (const raw of value as CompatibleMissingSchemaArtifact[]) {
    const artifact = typeof raw?.artifact === "string" ? raw.artifact.trim() : ""
    const reason = typeof raw?.reason === "string" ? raw.reason.trim() : ""
    if (!artifact || !reason) {
      throw new Error(`${source}: compatible missing schema artifacts require artifact and reason`)
    }
    if (!/^(?:table|index|column):/u.test(artifact)) {
      throw new Error(`${source}: invalid schema artifact key ${artifact}`)
    }
    if (!expected.has(artifact)) {
      throw new Error(`${source}: compatible missing artifact is stale or unknown: ${artifact}`)
    }
    if (allowed.has(artifact)) {
      throw new Error(`${source}: duplicate compatible missing artifact: ${artifact}`)
    }
    allowed.add(artifact)
  }
  return allowed
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
  expected: ReadonlyMap<string, { checksum: string; artifacts: Artifacts }>,
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
      ...exp.artifacts.absentIndexes.map(
        (idx) => `(SELECT COUNT(*) = 0 FROM sqlite_master WHERE type='index' AND name='${idx}')`,
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
  driftPolicy: string
  canonicalBaseline?: string
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
    [--prod] [--features rewards] [--manifest PATH] [--quarantines PATH]
    [--drift-policy PATH] [--canonical-baseline PATH] [--concurrency N]

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
    driftPolicy: resolve(get("--drift-policy") ?? "db/known-community-migration-drifts.json"),
    canonicalBaseline: get("--canonical-baseline") ? resolve(get("--canonical-baseline")!) : undefined,
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
  const maxAttempts = 4
  let lastError = "unknown Wrangler failure"
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const proc = Bun.spawn(cmd, { cwd: o.cwd, stdout: "pipe", stderr: "pipe" })
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    await proc.exited
    try {
      if (proc.exitCode !== 0) throw new Error(wranglerFailureDetail(out, err))
      return extractWranglerJson(out) as any[]
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))))
      }
    }
  }
  throw new Error(`wrangler d1 execute ${db} failed after ${maxAttempts} attempts: ${lastError}`)
}

type ProbeRunner = (sql: string) => Promise<Record<string, number>>

/** D1 occasionally rejects a large, otherwise valid multi-migration SELECT with
 * API error 7500 on a specific database. Preserve the one-query fleet fast path,
 * but attest that shard migration-by-migration after the combined probe has
 * exhausted its own retries. Every required result is still read and remapped;
 * any failed single probe remains a blocking shard error. */
export async function probeShard(
  required: string[],
  expected: ReadonlyMap<string, { checksum: string; artifacts: Artifacts }>,
  run: ProbeRunner,
): Promise<Record<string, number>> {
  try {
    return await run(buildProbe(required, expected))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!/\bcode=7500\b/.test(detail)) throw error

    const merged: Record<string, number> = {}
    for (const [i, name] of required.entries()) {
      const row = await run(buildProbe([name], expected))
      merged[`l${i}`] = Number(row.l0 ?? 0)
      merged[`k${i}`] = Number(row.k0 ?? 0)
      merged[`a${i}`] = Number(row.a0 ?? 0)
    }
    return merged
  }
}

/** Wrangler --json writes structured API failures to stdout while configuration
 * warnings go to stderr. Prefer the structured body and omit account/database
 * identifiers from manifests and CI logs. */
export function wranglerFailureDetail(stdout: string, stderr: string): string {
  const out = stdout.trim()
  if (out) {
    try {
      const parsed = JSON.parse(out) as {
        error?: { name?: unknown; code?: unknown; text?: unknown; notes?: Array<{ text?: unknown }> }
      }
      if (parsed.error) {
        const name = typeof parsed.error.name === "string" ? parsed.error.name : "APIError"
        const code = typeof parsed.error.code === "number" || typeof parsed.error.code === "string"
          ? ` code=${String(parsed.error.code)}`
          : ""
        const notes = parsed.error.notes
          ?.map((note) => typeof note.text === "string" ? note.text.trim() : "")
          .filter(Boolean)
          .join("; ")
        const message = notes || (typeof parsed.error.text === "string" ? parsed.error.text.trim() : "request failed")
        return `${name}${code}: ${message}`
      }
    } catch {
      // Fall through to bounded raw output for non-JSON CLI failures.
    }
  }
  const raw = out || stderr.trim() || "(no stdout or stderr)"
  return raw.length > 2_000 ? `${raw.slice(0, 2_000)}…` : raw
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
  const fleet = o.prod ? "production" : "staging"
  const canonicalBaseline = o.canonicalBaseline
    ? validateCanonicalSchemaBaseline(JSON.parse(await readFile(o.canonicalBaseline, "utf8")), fleet, o.canonicalBaseline)
    : undefined
  if (canonicalBaseline && !req.canonical_schema) {
    throw new Error("--canonical-baseline requires canonical_schema: true in the requirements manifest")
  }

  const required = [...req.unconditional]
  const featureRequired: Record<string, string[]> = {}
  for (const f of o.features) {
    const spec = req.features?.[f]
    if (!spec) throw new Error(`--features ${f}: no such feature in ${o.requirements}`)
    featureRequired[f] = spec.migrations
    required.push(...spec.migrations)
  }
  const requiredSet = [...new Set(required)]
  const inactiveFeatureMigrations = Object.entries(req.features ?? {})
    .filter(([feature]) => !o.features.includes(feature))
    .flatMap(([, spec]) => spec.migrations)
  const canonicalExcludedMigrations = new Set([
    ...Object.keys(req.deferred ?? {}),
    ...Object.keys(req.transitional ?? {}),
    ...inactiveFeatureMigrations,
  ])
  const canonicalExpected = req.canonical_schema
    ? await buildCanonicalSchemaArtifacts({
        migrationsDir: o.migrationsDir,
        excludedMigrations: canonicalExcludedMigrations,
      })
    : new Set<string>()
  let compatibleMissingSchemaArtifacts = new Set<string>()
  if (req.canonical_schema) {
    const driftPolicy = JSON.parse(await readFile(o.driftPolicy, "utf8")) as {
      communityTemplate?: { compatibleMissingSchemaArtifacts?: unknown }
    }
    compatibleMissingSchemaArtifacts = validateCompatibleMissingSchemaArtifacts(
      driftPolicy.communityTemplate?.compatibleMissingSchemaArtifacts ?? [],
      canonicalExpected,
      o.driftPolicy,
    )
    if (canonicalBaseline) {
      const unknownArtifacts = [...new Set(Object.values(canonicalBaseline.profiles).flat())]
        .filter((artifact) => !canonicalExpected.has(artifact))
        .sort()
      if (unknownArtifacts.length) {
        throw new Error(`${o.canonicalBaseline}: baseline contains non-canonical artifact(s): ${unknownArtifacts.join(", ")}`)
      }
    }
  }

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
  if (canonicalBaseline) {
    const classified = new Set([...bindings, ...partition.quarantined.map((entry) => entry.binding)])
    const staleBindings = Object.keys(canonicalBaseline.shards).filter((binding) => !classified.has(binding)).sort()
    if (staleBindings.length) {
      throw new Error(`${o.canonicalBaseline}: baseline contains non-live, non-quarantined shard(s): ${staleBindings.join(", ")}`)
    }
  }
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
  let idx = 0
  async function worker() {
    while (idx < targets.length) {
      const { binding, db } = targets[idx++]
      try {
        const row = await probeShard(requiredSet, expected, async (sql) =>
          (await wranglerJson(o, db, sql))[0].results[0] as Record<string, number>,
        )
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
        if (req.canonical_schema) {
          const inventoryPayload = await wranglerJson(o, db, CANONICAL_SCHEMA_INVENTORY_SQL)
          const inventoryRows = inventoryPayload[0].results as SchemaObjectRow[]
          const actual = schemaArtifactsFromRows(inventoryRows)
          const canonicalMissing = [...canonicalExpected]
            .filter((artifact) => !actual.has(artifact) && !compatibleMissingSchemaArtifacts.has(artifact))
            .sort()
          const canonicalRegressions = canonicalBaseline
            ? canonicalSchemaRegressions(canonicalMissing, binding, canonicalBaseline)
            : canonicalMissing
          if (canonicalRegressions.length > 0) {
            status = canonicalBaseline ? "canonical_schema_regression" : "canonical_schema_missing"
            missing.push(...canonicalRegressions)
            const shown = canonicalMissing.slice(0, 12)
            details.push(
              `canonical schema missing ${canonicalMissing.length} artifact(s)` +
                (canonicalBaseline ? `, ${canonicalRegressions.length} beyond ratchet baseline` : "") +
                `: ${shown.join(", ")}` +
                (canonicalMissing.length > shown.length ? `, ... and ${canonicalMissing.length - shown.length} more` : ""),
            )
          }
          reports.push({
            binding,
            database_name: db,
            status,
            missing,
            canonical_missing: canonicalMissing,
            canonical_regressions: canonicalRegressions,
            ...(details.length ? { detail: details.join("; ") } : {}),
          })
          continue
        }
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
        fleet,
        requirements_version: req.version,
        requirements_file: o.requirements,
        shard_config: o.wranglerConfig,
        features_checked: o.features,
        required_migrations: requiredSet,
        feature_migrations: featureRequired,
        canonical_schema_checked: Boolean(req.canonical_schema),
        canonical_schema_mode: canonicalBaseline ? "ratchet" : req.canonical_schema ? "strict" : "disabled",
        canonical_schema_baseline: o.canonicalBaseline ?? null,
        canonical_schema_expected_artifacts: canonicalExpected.size,
        canonical_schema_excluded_migrations: [...canonicalExcludedMigrations].sort(),
        compatible_missing_schema_artifacts: [...compatibleMissingSchemaArtifacts].sort(),
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
  console.log(
    `canonical schema: ${req.canonical_schema ? `${canonicalExpected.size} expected artifact(s)` : "disabled"}`,
  )
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
