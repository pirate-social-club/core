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
 * Read-only by default. `--publish-attestations` writes only generation-fenced
 * verdicts to the shard-owned D1_POOL after invalidating the observed roster;
 * it never writes to a community database and never changes the gate verdict.
 *
 * Deliberately NOT "every historical migration on every configured D1": blank
 * pool databases and known historical drift make that noisy and untrustworthy.
 * Requirements are declared, versioned, and travel with the API commit.
 */
import { createHash, randomUUID } from "node:crypto"
import { Database } from "bun:sqlite"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { partitionQuarantinedBindings } from "./lib/community-shard-quarantine"
import type {
  D1ApiEnvelope,
  D1DatabaseTarget,
  D1MigrationLedgerRow,
  D1ProbeResult,
  D1ProbeRunner,
  D1QueryMetrics,
  D1QueryResult,
  D1QueryStatement,
  D1RestClient,
  D1SchemaObjectRow,
} from "./lib/d1-rest-types"
import { type Artifacts, artifactCount, expectedArtifacts } from "./community-schema-artifacts"
import {
  shardObservationProof,
  unavailableShardObservationProof,
  effectivePolicyDigest,
  effectivePolicyEvidenceFromContent,
  candidateARow,
  digest,
  validateManifest,
} from "./lib/schema-attestation-proof"
import {
  invalidatePoolAttestations,
  publishPoolAttestations,
} from "./lib/schema-attestation-publisher"
import {
  compareAttestationShadow,
  readPoolAttestationAggregate,
  type AttestationShadowComparison,
} from "./lib/schema-attestation-reader"

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
  | "unreachable" // the shard could not be inspected; this is not schema drift
  | "binding_unavailable" // D1 7403: target is unavailable from the configured account; repair routing/config
  | "error"

/** Anything other than `satisfied` fails the gate. Silence is not success. */
const SATISFIED: ShardStatus = "satisfied"

export function unavailableShardStatus(error: unknown): ShardStatus {
  const detail = error instanceof Error ? error.message : String(error)
  // Cloudflare 7429 is an exhausted overload retry, not evidence that a
  // migration is missing. Keep the gate fail-closed, but make the verdict and
  // remediation truthful so an operator can retry the measurement.
  if (/\bcode(?:=|:\s*)7429\b/i.test(detail)) return "unreachable"
  // Cloudflare 7403 is not a transient overload. The configured database is
  // absent or inaccessible to the selected account, so retries and temporary
  // shard quarantine would only hide stale configuration or wrong-account
  // routing.
  if (/\bcode(?:=|:\s*)7403\b/i.test(detail)) return "binding_unavailable"
  return "error"
}

type ShardReport = {
  binding: string
  database_name: string
  community_id?: string
  pool_version?: number
  status: ShardStatus
  missing: string[]
  canonical_missing?: string[]
  canonical_regressions?: string[]
  detail?: string
  observation_proof?: ReturnType<typeof shardObservationProof>
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

export const CANONICAL_SCHEMA_INVENTORY_SQL = `
  SELECT type, name, sql
  FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`

export const MIGRATION_LEDGER_INVENTORY_SQL = `
  SELECT migration_name, checksum
  FROM schema_migrations
  ORDER BY migration_name
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

export function schemaArtifactsFromRows(rows: D1SchemaObjectRow[]): Set<string> {
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
      db.query<D1SchemaObjectRow, []>(CANONICAL_SCHEMA_INVENTORY_SQL).all(),
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
  driftPolicy: string
  canonicalBaseline?: string
  publishAttestations: boolean
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
    [--publish-attestations]

READ-ONLY unless --publish-attestations is explicit. Exits non-zero unless every
allocated+loaded shard is satisfied.
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
    driftPolicy: resolve(get("--drift-policy") ?? "db/known-community-migration-drifts.json"),
    canonicalBaseline: get("--canonical-baseline") ? resolve(get("--canonical-baseline")!) : undefined,
    publishAttestations: argv.includes("--publish-attestations"),
  }
}

export function databaseTargetsFromWranglerConfig(
  value: unknown,
  production: boolean,
  source = "wrangler config",
): Map<string, D1DatabaseTarget> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: expected a configuration object`)
  }
  const config = value as {
    d1_databases?: unknown
    env?: { production?: { d1_databases?: unknown } }
  }
  const entries = production ? config.env?.production?.d1_databases : config.d1_databases
  if (!Array.isArray(entries)) {
    throw new Error(`${source}: selected environment has no d1_databases array`)
  }
  const targets = new Map<string, D1DatabaseTarget>()
  for (const entry of entries as Array<Record<string, unknown>>) {
    const binding = typeof entry.binding === "string" ? entry.binding : ""
    if (binding !== "D1_POOL" && !binding.startsWith("DB_CMTY")) continue
    const name = typeof entry.database_name === "string" ? entry.database_name : ""
    const id = typeof entry.database_id === "string" ? entry.database_id : ""
    if (!name || !id) {
      throw new Error(`${source}: ${binding || "(missing binding)"} requires database_name and database_id`)
    }
    if (targets.has(binding)) throw new Error(`${source}: duplicate D1 binding ${binding}`)
    targets.set(binding, { name, id })
  }
  if (!targets.has("D1_POOL")) throw new Error(`${source}: selected environment is missing D1_POOL`)
  return targets
}

function shardWorkerIdFromWranglerConfig(raw: unknown, prod: boolean, source: string): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${source}: expected an object`)
  const config = raw as { name?: unknown; env?: Record<string, { name?: unknown }> }
  const name = prod ? config.env?.production?.name : config.name
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${source}: selected environment is missing a shard Worker name`)
  }
  return name.trim()
}

function boundedDetail(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value
}

function d1ApiFailureDetail(
  response: Response,
  payload: unknown,
  rawBody: string,
): string | null {
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as D1ApiEnvelope
    : undefined
  const errors = envelope?.errors?.filter((error) => error && typeof error === "object") ?? []
  if (errors.length > 0) {
    return errors.map((error) => {
      const code = typeof error.code === "number" || typeof error.code === "string"
        ? ` code=${String(error.code)}`
        : ""
      const message = typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : "request failed"
      return `APIError${code}: ${message}`
    }).join("; ")
  }
  if (!response.ok) {
    const body = rawBody.trim()
    return `HTTP ${response.status}${body ? `: ${boundedDetail(body)}` : ""}`
  }
  if (envelope?.success !== true) return "APIError: response did not report success"
  return null
}

function redactD1Identifiers(detail: string, client: D1RestClient, target: D1DatabaseTarget): string {
  let redacted = detail
  for (const [secret, replacement] of [
    [client.accountId, "(account id redacted)"],
    [target.id, "(database id redacted)"],
    [client.apiToken, "(token redacted)"],
  ] as const) {
    if (secret) redacted = redacted.replaceAll(secret, replacement)
  }
  return redacted
}

function recordD1Error(metrics: D1QueryMetrics | undefined, detail: string): void {
  if (!metrics) return
  const code = detail.match(/\bcode(?:=|:\s*)(\d+)\b/i)?.[1] ?? "unknown"
  metrics.errors_by_code[code] = (metrics.errors_by_code[code] ?? 0) + 1
}

export async function d1QueryBatch(
  client: D1RestClient,
  target: D1DatabaseTarget,
  statements: Array<string | D1QueryStatement>,
): Promise<D1QueryResult[]> {
  if (statements.length === 0) throw new Error("D1 query batch must contain at least one statement")
  if (client.metrics) {
    client.metrics.logical_batches += 1
    client.metrics.statements_submitted += statements.length
  }
  const maxAttempts = 4
  let lastError = "unknown D1 API failure"
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now()
    if (client.metrics) client.metrics.http_attempts += 1
    try {
      const response = await client.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(client.accountId)}` +
          `/d1/database/${encodeURIComponent(target.id)}/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${client.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            batch: statements.map((statement) => typeof statement === "string" ? { sql: statement } : statement),
          }),
        },
      )
      const rawBody = await response.text()
      let payload: unknown
      try {
        payload = JSON.parse(rawBody)
      } catch {
        throw new Error(`HTTP ${response.status}: non-JSON response ${boundedDetail(rawBody.trim() || "(empty body)")}`)
      }
      const failure = d1ApiFailureDetail(response, payload, rawBody)
      if (failure) throw new Error(failure)
      const results = (payload as D1ApiEnvelope).result
      if (!Array.isArray(results) || results.length !== statements.length) {
        throw new Error(`APIError: expected ${statements.length} query result(s), received ${results?.length ?? 0}`)
      }
      const failedResult = results.find((result) => result?.success !== true)
      if (failedResult) throw new Error("APIError: one or more D1 query results did not report success")
      return results
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      lastError = redactD1Identifiers(detail, client, target)
      recordD1Error(client.metrics, lastError)
      if (attempt < maxAttempts) {
        if (client.metrics) client.metrics.retries += 1
        await client.sleep(500 * (2 ** (attempt - 1)))
      }
    } finally {
      if (client.metrics) {
        client.metrics.cumulative_http_attempt_duration_ms += Math.round(performance.now() - startedAt)
      }
    }
  }
  throw new Error(`D1 query ${target.name} failed after ${maxAttempts} attempts: ${lastError}`)
}

function queryResultRows<T>(result: D1QueryResult | undefined, label: string): T[] {
  if (!result || !Array.isArray(result.results)) {
    throw new Error(`${label} returned no rows`)
  }
  return result.results as T[]
}

/** D1 occasionally rejects a large, otherwise valid multi-migration SELECT with
 * API error 7500 on a specific database. Preserve the one-request fleet path,
 * but batch migration-by-migration probes in one fallback request after the
 * combined SELECT has exhausted its retries. */
export async function probeShard(
  required: string[],
  expected: ReadonlyMap<string, { checksum: string; artifacts: Artifacts }>,
  includeCanonicalInventory: boolean,
  run: D1ProbeRunner,
): Promise<D1ProbeResult> {
  const observationStatements = includeCanonicalInventory
    ? [CANONICAL_SCHEMA_INVENTORY_SQL, MIGRATION_LEDGER_INVENTORY_SQL]
    : []
  try {
    const results = await run([buildProbe(required, expected), ...observationStatements])
    const row = queryResultRows<Record<string, number>>(results[0], "combined migration probe")[0]
    if (!row) throw new Error("combined migration probe returned no rows")
    const inventoryRows = includeCanonicalInventory
      ? queryResultRows<D1SchemaObjectRow>(results[1], "canonical schema inventory")
      : []
    const migrationLedgerRows = includeCanonicalInventory
      ? queryResultRows<D1MigrationLedgerRow>(results[2], "migration ledger inventory")
      : []
    return { row, inventoryRows, migrationLedgerRows }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!/\bcode(?:=|:\s*)7500\b/i.test(detail)) throw error

    const statements = [
      ...required.map((name) => buildProbe([name], expected)),
      ...observationStatements,
    ]
    const results = await run(statements)
    const merged: Record<string, number> = {}
    for (const [i, name] of required.entries()) {
      const row = queryResultRows<Record<string, number>>(results[i], `fallback migration probe ${name}`)[0]
      if (!row) throw new Error(`fallback migration probe ${name} returned no rows`)
      merged[`l${i}`] = Number(row.l0 ?? 0)
      merged[`k${i}`] = Number(row.k0 ?? 0)
      merged[`a${i}`] = Number(row.a0 ?? 0)
    }
    const inventoryRows = includeCanonicalInventory
      ? queryResultRows<D1SchemaObjectRow>(results[required.length], "canonical schema inventory")
      : []
    const migrationLedgerRows = includeCanonicalInventory
      ? queryResultRows<D1MigrationLedgerRow>(results[required.length + 1], "migration ledger inventory")
      : []
    return { row: merged, inventoryRows, migrationLedgerRows }
  }
}

/** The pool is authoritative for which shards are LIVE — not a prior artifact. */
type LivePoolBinding = {
  binding_name: string
  community_id: string
  version: number
}

/** Capture allocation identity in the same roster read that defines the scan.
 * A later publisher must match all three values before it writes a verdict. */
async function liveBindings(client: D1RestClient, pool: D1DatabaseTarget): Promise<LivePoolBinding[]> {
  const results = await d1QueryBatch(client, pool, [
    "SELECT binding_name, community_id, version FROM d1_pool WHERE community_id IS NOT NULL AND last_loaded_at IS NOT NULL ORDER BY binding_name",
  ])
  const rows = queryResultRows<LivePoolBinding>(results[0], "live shard pool query")
  if (rows.length === 0) {
    throw new Error(`${pool.name} reported ZERO live shards. That is a broken view of the fleet, not a pass.`)
  }
  for (const row of rows) {
    if (!row.binding_name || !row.community_id || !Number.isInteger(row.version) || row.version < 0) {
      throw new Error(`${pool.name} returned an invalid live shard allocation row`)
    }
  }
  return rows
}

async function main() {
  const o = parseArgs()
  const requirementsContent = await readFile(o.requirements, "utf8")
  const req = validateRequirements(JSON.parse(requirementsContent), o.requirements)
  const fleet = o.prod ? "production" : "staging"
  const canonicalBaselineContent = o.canonicalBaseline
    ? await readFile(o.canonicalBaseline, "utf8")
    : null
  const canonicalBaseline = o.canonicalBaseline
    ? validateCanonicalSchemaBaseline(JSON.parse(canonicalBaselineContent!), fleet, o.canonicalBaseline)
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
  const driftPolicyContent = await readFile(o.driftPolicy, "utf8")
  let compatibleMissingSchemaArtifacts = new Set<string>()
  if (req.canonical_schema) {
    const driftPolicy = JSON.parse(driftPolicyContent) as {
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

  const migrationContents = await Promise.all(
    (await readdir(o.migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map(async (name) => ({
        name,
        checksum: createHash("sha256")
          .update(await readFile(resolve(o.migrationsDir, name), "utf8"))
          .digest("hex"),
      })),
  )
  const policyEvidence = effectivePolicyEvidenceFromContent({
    requirementsContent,
    migrations: migrationContents,
    classifications: {
      features_checked: [...o.features].sort(),
      unconditional: [...req.unconditional].sort(),
      features: Object.fromEntries(Object.entries(req.features ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([feature, spec]) => [feature, {
          enabled: o.features.includes(feature),
          flags: [...spec.flags].sort(),
          migrations: [...spec.migrations].sort(),
        }])),
      transitional: Object.keys(req.transitional ?? {}).sort(),
      deferred: Object.keys(req.deferred ?? {}).sort(),
      ledger_only: Object.keys(req.ledger_only ?? {}).sort(),
      canonical_excluded_migrations: [...canonicalExcludedMigrations].sort(),
    },
    canonicalExpectedArtifacts: [...canonicalExpected],
    canonicalBaselineProfiles: canonicalBaseline?.profiles ?? null,
    driftPolicyContent,
  })
  const policyDigest = effectivePolicyDigest(policyEvidence)

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for read-only D1 attestation")
  }
  const d1QueryMetrics: D1QueryMetrics = {
    logical_batches: 0,
    statements_submitted: 0,
    http_attempts: 0,
    retries: 0,
    errors_by_code: {},
    cumulative_http_attempt_duration_ms: 0,
  }
  const client: D1RestClient = {
    accountId,
    apiToken,
    fetch,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    metrics: d1QueryMetrics,
  }
  const raw = (await readFile(o.wranglerConfig, "utf8")).replace(/^\s*\/\/.*$/gm, "")
  const wranglerConfig = JSON.parse(raw)
  const shardWorkerId = shardWorkerIdFromWranglerConfig(wranglerConfig, o.prod, o.wranglerConfig)
  const targets = databaseTargetsFromWranglerConfig(wranglerConfig, o.prod, o.wranglerConfig)
  const pool = targets.get("D1_POOL")
  if (!pool) throw new Error(`${o.wranglerConfig}: selected environment is missing D1_POOL`)

  const livePoolBindings = await liveBindings(client, pool)
  const allocatedBindings = livePoolBindings.map((row) => row.binding_name)
  const allocationByBinding = new Map(livePoolBindings.map((row) => [row.binding_name, row]))
  const partition = await partitionQuarantinedBindings(
    o.quarantineRegistry,
    o.prod ? "production" : "staging",
    allocatedBindings,
    new Set(targets.keys()),
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
  const writerRunId = [
    "full-scan",
    fleet,
    process.env.GITHUB_RUN_ID?.trim() || "local",
    process.env.GITHUB_RUN_ATTEMPT?.trim() || "1",
    randomUUID(),
  ].join(":")
  if (o.publishAttestations) {
    await invalidatePoolAttestations({
      shardWorkerId,
      writerRunId,
      policyDigest,
      unavailableDigest: digest({ unavailable: "authoritative_full_scan_in_progress" }),
      expectedRoster: livePoolBindings,
      run: (statements) => d1QueryBatch(client, pool, statements),
    })
  }
  const reports: ShardReport[] = []
  const shardTargets: Array<{ binding: string; database: D1DatabaseTarget; allocation: LivePoolBinding }> = []
  for (const b of bindings) {
    const allocation = allocationByBinding.get(b)
    if (!allocation) throw new Error(`live shard ${b} disappeared from its allocation roster`)
    const database = targets.get(b)
    if (!database) {
      // A live shard the config does not know about means our config is stale.
      // Skipping it is how 178 shards once went un-migrated. Fail.
      reports.push({
        binding: b,
        database_name: "(absent from shard config)",
        community_id: allocation.community_id,
        pool_version: allocation.version,
        status: "missing_from_config",
        missing: requiredSet,
        detail: `live in the pool but absent from ${o.wranglerConfig} — the config is stale`,
        observation_proof: unavailableShardObservationProof("missing_from_config"),
      })
      continue
    }
    shardTargets.push({ binding: b, database, allocation })
  }

  // ONE HTTP request per shard in the healthy path. The migration probe and
  // canonical inventory remain logically independent query results, but D1's
  // REST batch endpoint carries both in one authenticated round trip.
  let idx = 0
  async function worker() {
    while (idx < shardTargets.length) {
      const { binding, database, allocation } = shardTargets[idx++]
      try {
        const probe = await probeShard(
          requiredSet,
          expected,
          true,
          (statements) => d1QueryBatch(client, database, statements),
        )
        const row = probe.row
        const missing: string[] = []
        let status: ShardStatus = SATISFIED
        const details: string[] = []
        const actual = schemaArtifactsFromRows(probe.inventoryRows)
        const observationProof = shardObservationProof({
          schemaRows: probe.inventoryRows,
          migrationLedgerRows: probe.migrationLedgerRows,
          canonicalArtifacts: [...actual],
        })

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
            database_name: database.name,
            community_id: allocation.community_id,
            pool_version: allocation.version,
            status,
            missing,
            canonical_missing: canonicalMissing,
            canonical_regressions: canonicalRegressions,
            observation_proof: observationProof,
            ...(details.length ? { detail: details.join("; ") } : {}),
          })
          continue
        }
        reports.push({
          binding,
          database_name: database.name,
          community_id: allocation.community_id,
          pool_version: allocation.version,
          status,
          missing,
          observation_proof: observationProof,
          ...(details.length ? { detail: details.join("; ") } : {}),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        reports.push({
          binding,
          database_name: database.name,
          community_id: allocation.community_id,
          pool_version: allocation.version,
          status: unavailableShardStatus(error),
          missing: requiredSet,
          detail,
          observation_proof: unavailableShardObservationProof({
            status: unavailableShardStatus(error),
            detail,
          }),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency, Math.max(shardTargets.length, 1)) }, worker))

  const summary: Record<string, number> = {}
  for (const r of reports) summary[r.status] = (summary[r.status] ?? 0) + 1
  const failures = reports.filter((r) => r.status !== SATISFIED)

  const publication: {
    enabled: boolean
    writer_run_id: string | null
    invalidated: number
    published: number
    status: "disabled" | "pending" | "published"
  } = {
    enabled: o.publishAttestations,
    writer_run_id: o.publishAttestations ? writerRunId : null,
    invalidated: o.publishAttestations ? livePoolBindings.length : 0,
    published: 0,
    status: o.publishAttestations ? "pending" : "disabled",
  }
  // Shadow evidence intentionally does not affect this command's exit status:
  // the REST scan remains the release authority until a later activation review.
  // It must, however, distinguish agreement from a reader that always abstains.
  const attestationShadow: {
    enabled: boolean
    status: "disabled" | "pending" | "compared"
    comparison: AttestationShadowComparison | null
  } = {
    enabled: o.publishAttestations,
    status: o.publishAttestations ? "pending" : "disabled",
    comparison: null,
  }
  const manifest = {
    fleet,
    shard_worker_id: shardWorkerId,
    requirements_version: req.version,
    requirements_file: o.requirements,
    shard_config: o.wranglerConfig,
    features_checked: o.features,
    required_migrations: requiredSet,
    feature_migrations: featureRequired,
    canonical_schema_checked: Boolean(req.canonical_schema),
    canonical_schema_mode: canonicalBaseline ? "ratchet" as const : req.canonical_schema ? "strict" as const : "disabled" as const,
    canonical_schema_baseline: o.canonicalBaseline ?? null,
    canonical_schema_expected_artifacts: canonicalExpected.size,
    canonical_schema_excluded_migrations: [...canonicalExcludedMigrations].sort(),
    compatible_missing_schema_artifacts: [...compatibleMissingSchemaArtifacts].sort(),
    policy_evidence: policyEvidence,
    effective_policy_digest: policyDigest,
    d1_query_transport: "rest_batch",
    d1_query_metrics: d1QueryMetrics,
    allocated_loaded_shards: allocatedBindings.length,
    live_shards: bindings.length,
    quarantined_shards: partition.quarantined.length,
    quarantine_registry: o.quarantineRegistry,
    quarantine_registry_checksum: partition.registryChecksum,
    quarantines: partition.quarantined,
    classified: reports.length,
    summary,
    shards: reports,
    attestation_publication: publication,
    attestation_shadow: attestationShadow,
  }

  await mkdir(dirname(o.manifest), { recursive: true })
  const writeManifest = () => writeFile(o.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeManifest()

  if (o.publishAttestations) {
    const validated = validateManifest(manifest, o.manifest)
    const verifiedAt = new Date().toISOString()
    const rows = reports.map((report) => candidateARow(report, validated, {
      shardWorkerId,
      communityId: report.community_id,
      poolVersion: report.pool_version,
      runId: writerRunId,
      verifiedAt,
      policyDigest,
    }))
    await publishPoolAttestations({
      rows,
      run: (statements) => d1QueryBatch(client, pool, statements),
    })
    publication.published = reports.length
    publication.status = "published"
    const aggregate = await readPoolAttestationAggregate({
      shardWorkerId,
      policyDigest,
      quarantinedBindings: partition.quarantined.map((quarantine) => quarantine.binding),
      run: (statements) => d1QueryBatch(client, pool, statements),
    })
    attestationShadow.comparison = compareAttestationShadow({
      aggregate,
      expectedLiveCount: bindings.length,
      authoritativePass: failures.length === 0,
    })
    attestationShadow.status = "compared"
    await writeManifest()
  }

  console.log(`fleet=${o.prod ? "PRODUCTION" : "staging"}  allocated+loaded=${allocatedBindings.length}  live=${bindings.length}  quarantined=${partition.quarantined.length}`)
  console.log(`required (unconditional): ${req.unconditional.join(", ")}`)
  console.log(
    `required (features ${o.features.join(",") || "none"}): ${Object.values(featureRequired).flat().join(", ") || "none"}`,
  )
  console.log(`summary: ${JSON.stringify(summary)}`)
  console.log(
    `canonical schema: ${req.canonical_schema ? `${canonicalExpected.size} expected artifact(s)` : "disabled"}`,
  )
  console.log(`D1 REST query metrics: ${JSON.stringify(d1QueryMetrics)}`)
  console.log(`manifest: ${o.manifest}`)
  console.log(`attestation publication: ${o.publishAttestations ? `published ${reports.length} generation-fenced verdict(s)` : "disabled"}`)
  if (attestationShadow.comparison) {
    console.log(`attestation shadow: would_fast_path_fire=${attestationShadow.comparison.would_fast_path_fire} authoritative_match=${attestationShadow.comparison.authoritative_match}`)
    if (!attestationShadow.comparison.would_fast_path_fire) {
      console.log(`attestation shadow non-fire reasons: ${JSON.stringify({
        missing: attestationShadow.comparison.missing_count,
        fresh_allocation_unattested: attestationShadow.comparison.fresh_allocation_unattested_count,
        stale_generation_proof: attestationShadow.comparison.stale_generation_proof_count,
        unexplained_missing_proof: attestationShadow.comparison.unexplained_missing_proof_count,
        invalid: attestationShadow.comparison.invalid_count,
        policy_mismatch: attestationShadow.comparison.policy_mismatch_count,
        roster_mismatch: !attestationShadow.comparison.roster_matches_authoritative,
      })}`)
    }
  }

  // Every live shard must be classified. An unclassified shard is not a pass.
  if (reports.length !== bindings.length) {
    console.error(
      `::error::Incomplete classification: ${bindings.length} live shards, ${reports.length} classified.`,
    )
    process.exit(2)
  }

  if (failures.length > 0) {
    console.error(`\n::error::${failures.length} live shard(s) do not have a passing pinned-schema attestation.`)
    for (const f of failures.slice(0, 20)) {
      console.error(`  ${f.database_name} [${f.binding}]: ${f.status} — ${f.detail ?? f.missing.join(", ")}`)
    }
    if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more (see manifest)`)
    const unreachable = failures.filter((report) => report.status === "unreachable")
    const unavailableBindings = failures.filter((report) => report.status === "binding_unavailable")
    const schemaFailures = failures.filter(
      (report) => report.status !== "unreachable" && report.status !== "binding_unavailable",
    )
    if (schemaFailures.length > 0) {
      console.error("\nApply the missing community-template migrations to the fleet before this API can deploy.")
    }
    if (unreachable.length > 0) {
      console.error(
        `\n${unreachable.length} shard(s) could not be inspected after retries; this is not schema-drift evidence. ` +
          "Retry the unchanged gate, and investigate the fleet if the same shard remains unreachable.",
      )
    }
    if (unavailableBindings.length > 0) {
      console.error(
        `\n${unavailableBindings.length} shard binding(s) target a D1 database unavailable from the configured account ` +
          "(Cloudflare 7403). Do not quarantine or blindly retry them; verify account routing, then remove or repoint only if the target is stale.",
      )
    }
    console.error("Do NOT weaken this gate to go green — it exists because 1124 and 1127 each broke production.")
    process.exit(2)
  }

  console.log(`\nPASS: all ${bindings.length} live shards satisfy the pinned API's schema requirements; ${partition.quarantined.length} explicitly quarantined.`)
}

if (import.meta.main) await main()
