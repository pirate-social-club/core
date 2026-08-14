/**
 * Shared machinery for applying ONE community-template migration across the
 * allocated+loaded community D1 fleet.
 *
 * Why this is a library and not another copy-pasted script
 * -------------------------------------------------------
 * Per-shard migrations are applied by hand. Twice now a hand-rolled rollout has
 * aborted on a transient Cloudflare error and left a contiguous un-migrated tail,
 * which the deployed API then hit as a live outage (1124 -> post publish broken on
 * 25 shards; 1127 -> 3 shards). Every new one-off script re-derives the same
 * safety properties and gets a chance to omit one. A migration is now a SPEC; the
 * machinery below is written once.
 *
 * Safety properties (do not weaken any of these)
 * ----------------------------------------------
 * - Read-only by default. `--execute` is required to write, and it in turn
 *   requires `--confirm-time-travel` (D1 Time Travel is the rollback path).
 * - Fleet writes REQUIRE `--resume-file`, so a transient failure can never leave
 *   an unrecorded tail: completed shards are appended as they land, keyed by
 *   migration AND shard (`migration<TAB>shard`). A bare shard-only line from a
 *   pre-keyed runner is IGNORED — it loses skip power rather than being
 *   misparsed, so the worst case is an idempotent re-classification, never a
 *   skipped write. Keying is what keeps one shared resume file safe across a
 *   multi-spec run: a shard done for spec A is still classified for spec B.
 * - Fleet writes REQUIRE origin/main provenance: with `--execute`, HEAD must be
 *   contained in the local origin/main ref and the working tree clean — twice,
 *   fleet-affecting state was built from non-main refs (1097 ledger rows; two
 *   shards provisioned from an unmerged template bundle). `--allow-non-main` is
 *   a loud, manifest-recorded break-glass, not a convenience.
 * - Fleet writes REQUIRE config provenance too: the checkout holding
 *   `--wrangler-config` must also be main-contained and clean — a stale config
 *   checkout once showed a fleet tool 26 of ~205 bindings. Read-only runs never
 *   block but warn loudly on config-side anomalies, because a stale config on
 *   a dry run produces a confidently wrong report.
 * - The pool is authoritative for fleet membership. Zero allocated shards is an
 *   error, never "no work to do".
 * - A shard allocated in the pool but absent from the shard config is BLOCKING,
 *   never skippable — that is exactly how a stale config once hid live shards
 *   from a fleet migration.
 * - Anything not positively understood (partial objects, ledger present but
 *   objects absent, checksum mismatch) is reported and NOT written to. The one
 *   exception is an exact-checksum ledger-without-objects state when BOTH the
 *   reviewed migration spec and an explicit operator flag authorize repair.
 * - Schema + ledger move together in one file, so a shard is never left with the
 *   objects but no ledger row (or vice versa).
 * - A run that used `--resume-file` or `--only` is an execution record, NOT proof
 *   of final state. Only a clean read-only pass over the whole fleet proves that.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { d1QueryBatch } from "../verify-community-schema-requirements"
import { partitionQuarantinedBindings } from "./community-shard-quarantine"
import type { D1RestClient } from "./d1-rest-types"
import { decideFleetProvenance, probeConfigRepoProvenance, probeRolloutProvenance } from "./rollout-provenance"

/** The schema objects a migration creates. Presence is how a shard is classified. */
export type ObjectSpec =
  | { kind: "columns"; table: string; columns: readonly string[] }
  | { kind: "columns_by_table"; columns: readonly { table: string; column: string }[] }
  | { kind: "table_sql_contains"; table: string; fragments: readonly string[] }
  | {
      kind: "schema_objects"
      columns: readonly { table: string; column: string }[]
      indexes: readonly string[]
      tables?: readonly string[]
      tableSqlContains?: readonly { table: string; fragments: readonly string[] }[]
      /** Existing names that must be present once any new migration marker exists. */
      finalIndexes?: readonly string[]
      /** Intermediate rebuild tables that must never remain after the migration. */
      forbiddenTables?: readonly string[]
    }
  | { kind: "tables"; tables: readonly string[] }

export type MigrationSpec = {
  /** File name inside the migrations dir, e.g. "1126_reward_qualification_outbox.sql". */
  migration: string
  /** Ledger label, e.g. "community-template". */
  label: string
  /** Tables that must already exist for this migration to be applicable at all. */
  requiredTables: readonly string[]
  /** Existing source columns that a rebuild must be able to copy. */
  requiredColumns?: readonly { table: string; column: string }[]
  /** What the migration creates. */
  creates: ObjectSpec
  /** Optional pre-write row counts recorded in each shard's manifest entry. */
  rowCountTables?: readonly string[]
  /**
   * Whether the DDL is safe to replay when its objects already exist.
   * Plain `ADD COLUMN` and plain `CREATE TABLE` are NOT: they fail with
   * "duplicate column name" / "table already exists". For those we backfill the
   * LEDGER ONLY and never re-run the DDL.
   */
  replayableDdl: boolean
  /**
   * Optional data repair to run before backfilling a missing ledger row when
   * every schema object already exists. It must be safe to repeat and must not
   * overwrite non-null application data.
   */
  ledgerBackfillSql?: string
  /**
   * Permit an explicit repair when the exact migration checksum is already in
   * the ledger but every migration-owned schema marker is absent. Partial
   * states and checksum drift remain blocking. The repair replays the original
   * migration bytes without touching the already-correct ledger row.
   */
  repairLedgerWithoutObjects?: boolean
  /** Short human description used in --help. */
  description: string
}

export type Status =
  | "ok_recorded" // ledger + all objects, checksum matches -> nothing to do
  | "needs_migration" // no ledger, no objects -> apply DDL + ledger
  | "needs_ledger_backfill" // objects present, ledger missing -> ledger INSERT only
  | "needs_ledger_repair" // exact ledger present, objects absent, explicit reviewed repair -> replay DDL only
  | "checksum_mismatch" // ledger records a DIFFERENT migration of this name -> refuse
  | "ledger_without_objects" // ledger says applied, objects absent -> refuse
  | "partial_objects" // some but not all objects -> refuse
  | "schema_not_ready" // required tables or schema_migrations absent -> refuse
  | "missing_from_config" // allocated in the pool but absent from the shard config -> refuse
  | "error"

/**
 * Any of these fails the run. `missing_from_config` and `schema_not_ready` are
 * here because silently skipping a live shard is how a fleet migration lies.
 */
export const BLOCKING_STATUSES: readonly Status[] = [
  "checksum_mismatch",
  "ledger_without_objects",
  "partial_objects",
  "schema_not_ready",
  "missing_from_config",
  "error",
]

export type ShardResult = {
  binding: string
  database_name: string
  database_id: string
  status: Status
  action: "none" | "applied_migration" | "backfilled_ledger" | "repaired_ledger_without_objects"
  row_counts?: Record<string, number>
  classification_duration_ms?: number
  apply_duration_ms?: number
  detail?: string
}

export type Options = {
  wranglerConfig: string
  migrationsDir: string
  env?: string
  poolDb: string
  quarantineRegistry: string
  prod: boolean
  execute: boolean
  confirmTimeTravel: boolean
  allowNonMain: boolean
  repairQuarantinedOnly: boolean
  repairLedgerWithoutObjects: boolean
  manifest: string
  resumeFile?: string
  only?: string
  concurrency: number
  cwd: string
}

const ANSI = /\[[0-9;?]*[A-Za-z]/g

/**
 * `wrangler d1 execute --file` interleaves upload progress and ANSI control
 * sequences with its JSON payload on STDOUT, so the output is not parseable
 * as-is. Strip ANSI, then take the FIRST bracket from which the remainder parses
 * as a JSON array.
 *
 * Scanning forward (not backward) matters: a nested `[` — e.g. the one opening
 * `"results": [...]` — would also parse, but as the WRONG value. The first
 * position that parses cleanly to the end is the true top-level payload.
 */
export function extractWranglerJson(stdout: string): unknown[] {
  const clean = stdout.replace(ANSI, "").replace(/\r/g, "")
  for (let i = clean.indexOf("["); i !== -1; i = clean.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(clean.slice(i))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Not the payload — a bracket inside progress text. Keep scanning.
    }
  }
  throw new Error(`no JSON array payload found in wrangler output: ${clean.slice(0, 200)}`)
}

/** The SQL that decides a shard's status. Exported so it is unit-testable without a fleet. */
export function classificationSql(spec: MigrationSpec): string {
  const required = spec.requiredTables
    .map((t) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}') AS req_${t}`)
    .join(",\n  ")
  const requiredColumns = (spec.requiredColumns ?? []).length > 0
    ? `(SELECT COALESCE(GROUP_CONCAT(missing), '') FROM (${(spec.requiredColumns ?? []).map(({ table, column }) =>
      `SELECT '${table}.${column}' AS missing WHERE (SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='${column}') = 0`
    ).join(" UNION ALL ")})) AS missing_required_columns`
    : ""
  const objects = spec.creates.kind === "columns"
    ? spec.creates.columns
      .map((c) => `(SELECT COUNT(*) FROM pragma_table_info('${spec.creates.table}') WHERE name='${c}') AS obj_${c}`)
      .join(",\n  ")
    : spec.creates.kind === "columns_by_table"
      ? spec.creates.columns
        .map(({ table, column }) => `(SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='${column}') AS obj_${table}__${column}`)
        .join(",\n  ")
      : spec.creates.kind === "table_sql_contains"
        ? spec.creates.fragments
          .map((fragment, index) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${spec.creates.table}' AND instr(lower(sql), lower('${fragment.replaceAll("'", "''")}')) > 0) AS obj_fragment__${index}`)
          .join(",\n  ")
      : spec.creates.kind === "schema_objects"
        ? [
            ...spec.creates.columns.map(({ table, column }) =>
              `(SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='${column}') AS obj_${table}__${column}`
            ),
            ...spec.creates.indexes.map((index) =>
              `(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${index}') AS obj_index__${index}`
            ),
            ...(spec.creates.finalIndexes ?? []).map((index) =>
              `(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${index}') AS final_index__${index}`
            ),
            ...(spec.creates.forbiddenTables ?? []).map((table) =>
              `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}') AS forbidden_table__${table}`
            ),
            ...(spec.creates.tables ?? []).map((table) =>
              `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}') AS obj_table__${table}`
            ),
            ...(spec.creates.tableSqlContains ?? []).flatMap(({ table, fragments }) =>
              fragments.map((fragment, index) =>
                `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}' AND instr(lower(sql), lower('${fragment.replaceAll("'", "''")}')) > 0) AS obj_table_fragment__${table}__${index}`
              )
            ),
          ].join(",\n  ")
        : spec.creates.tables
          .map((t) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}') AS obj_${t}`)
          .join(",\n  ")

  const probes = [
    "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_ledger",
    `(SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${spec.migration}') AS ledger_checksum`,
    ...(required ? [required] : []),
    ...(requiredColumns ? [requiredColumns] : []),
    ...(objects ? [objects] : []),
  ]
  return `SELECT\n  ${probes.join(",\n  ")}`
}

/** Kept separate so an absent required table is classified cleanly before it is counted. */
export function rowCountSql(spec: MigrationSpec): string | null {
  const tables = spec.rowCountTables ?? []
  if (tables.length === 0) return null
  const nonRequired = tables.filter((table) => !spec.requiredTables.includes(table))
  if (nonRequired.length > 0) {
    throw new Error(`rowCountTables must also be requiredTables: ${nonRequired.join(", ")}`)
  }
  return `SELECT\n  ${tables
    .map((table) => `(SELECT COUNT(*) FROM '${table.replaceAll("'", "''")}') AS metric_rows__${table}`)
    .join(",\n  ")}`
}

function objectNames(spec: MigrationSpec): readonly string[] {
  if (spec.creates.kind === "columns") return spec.creates.columns
  if (spec.creates.kind === "columns_by_table") {
    return spec.creates.columns.map(({ table, column }) => `${table}__${column}`)
  }
  if (spec.creates.kind === "table_sql_contains") {
    return spec.creates.fragments.map((_, index) => `fragment__${index}`)
  }
  if (spec.creates.kind === "schema_objects") {
    return [
      ...spec.creates.columns.map(({ table, column }) => `${table}__${column}`),
      ...spec.creates.indexes.map((index) => `index__${index}`),
      ...(spec.creates.tables ?? []).map((table) => `table__${table}`),
      ...(spec.creates.tableSqlContains ?? []).flatMap(({ table, fragments }) =>
        fragments.map((_, index) => `table_fragment__${table}__${index}`)
      ),
    ]
  }
  return spec.creates.tables
}

function cell(r: Record<string, number | string>, key: string): number | string {
  return r[key] ?? 0
}

function missingFinalInvariants(spec: MigrationSpec, rows: Record<string, number | string>): readonly string[] {
  if (spec.creates.kind !== "schema_objects") return []
  return (spec.creates.finalIndexes ?? [])
    .filter((index) => Number(cell(rows, `final_index__${index}`)) !== 1)
    .map((index) => `index__${index}`)
}

function presentForbiddenObjects(spec: MigrationSpec, rows: Record<string, number | string>): readonly string[] {
  if (spec.creates.kind !== "schema_objects") return []
  return (spec.creates.forbiddenTables ?? [])
    .filter((table) => Number(cell(rows, `forbidden_table__${table}`)) !== 0)
    .map((table) => `table__${table}`)
}

/** Pure classification from an already-fetched row. Unit-testable. */
export function classifyRow(
  spec: MigrationSpec,
  rows: Record<string, number | string>,
  checksum: string,
): { status: Status; detail?: string } {
  if (Number(cell(rows, "has_ledger")) !== 1) {
    return { status: "schema_not_ready", detail: "schema_migrations table absent" }
  }
  const missingRequired = spec.requiredTables.filter((t) => Number(cell(rows, `req_${t}`)) !== 1)
  if (missingRequired.length > 0) {
    return { status: "schema_not_ready", detail: `required table(s) absent: ${missingRequired.join(", ")}` }
  }
  const missingRequiredColumns = String(typeof rows.missing_required_columns === "string" ? rows.missing_required_columns : "")
    .split(",")
    .filter(Boolean)
  if (missingRequiredColumns.length > 0) {
    return {
      status: "schema_not_ready",
      detail: `required source column(s) absent: ${missingRequiredColumns.join(", ")}`,
    }
  }

  const names = objectNames(spec)
  const present = names.filter((n) => Number(cell(rows, `obj_${n}`)) === 1)
  const missingFinal = missingFinalInvariants(spec, rows)
  const forbiddenPresent = presentForbiddenObjects(spec, rows)
  const recorded = String(rows.ledger_checksum ?? "")

  if (forbiddenPresent.length > 0) {
    return { status: "partial_objects", detail: `forbidden intermediate object(s): ${forbiddenPresent.join(", ")}` }
  }
  if (present.length > 0 && present.length < names.length) {
    return { status: "partial_objects", detail: `present: ${present.join(", ")}` }
  }
  const allMarkersPresent = present.length === names.length
  if (allMarkersPresent && missingFinal.length > 0) {
    return { status: "partial_objects", detail: `missing final invariant(s): ${missingFinal.join(", ")}` }
  }
  const allPresent = allMarkersPresent && missingFinal.length === 0

  if (recorded) {
    if (recorded !== checksum) {
      return {
        status: "checksum_mismatch",
        detail: `ledger=${recorded.slice(0, 12)} expected=${checksum.slice(0, 12)}`,
      }
    }
    return allPresent
      ? { status: "ok_recorded" }
      : {
          status: "ledger_without_objects",
          detail: `ledger records ${spec.migration} but its objects are absent`,
        }
  }
  // No ledger row. If the DDL cannot be replayed where its objects already exist,
  // repair the LEDGER ONLY — never re-run the DDL.
  if (allPresent) {
    return spec.replayableDdl
      ? { status: "needs_migration" }
      : { status: "needs_ledger_backfill" }
  }
  return { status: "needs_migration" }
}

/**
 * Preserve ledger_without_objects as blocking unless two independent controls
 * agree: the reviewed spec declares this migration repairable, and the operator
 * explicitly requests that repair for this run.
 */
export function planLedgerWithoutObjectsRepair(
  spec: MigrationSpec,
  status: Status,
  requested: boolean,
): Status {
  return requested && spec.repairLedgerWithoutObjects === true && status === "ledger_without_objects"
    ? "needs_ledger_repair"
    : status
}

export function usage(spec: MigrationSpec, scriptPath: string): never {
  console.error(`
Apply community-template ${spec.migration} across allocated+loaded community shards.
${spec.description}

  bun ${scriptPath} \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc [options]

Options:
  --wrangler-config PATH   Shard wrangler.jsonc (lives in the api repo).
  --migrations-dir PATH    Default: db/community-template/migrations
  --prod                   Target the production fleet. Default: staging.
  --only DB_NAME           Canary a single database.
  --manifest PATH          Write the classification manifest / results here.
  --quarantines PATH       Versioned quarantine registry.
  --resume-file PATH       Record completed shards (keyed migration+shard);
                           re-runs skip them.
  --concurrency N          Default 8.
  --execute                Write. Without it, this is a read-only dry run.
  --confirm-time-travel    Required with --execute.
  --allow-non-main         Break-glass: allow --execute from a HEAD that is not
                           contained in origin/main (loud warning; recorded in
                           the manifest as overrideUsed).
  --repair-quarantined-only
                           Permit --only to target that one explicitly
                           quarantined database for in-place remediation. Never
                           includes other quarantined shards.
  --repair-ledger-without-objects
                           Replay the original migration bytes when the exact
                           ledger checksum exists but every owned object is
                           absent. Requires opt-in from the migration spec.

Read-only by default. Blank, never-loaded pool databases are never touched.
`)
  process.exit(1)
}

export function parseArgs(spec: MigrationSpec, scriptPath: string): Options {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const prod = argv.includes("--prod")
  const wranglerConfig = get("--wrangler-config")
  if (!wranglerConfig) usage(spec, scriptPath)
  // Use the complete migration name. Numeric prefixes are not globally unique in
  // the historical ledger; prefix-only manifests let sibling audits overwrite
  // one another and erase evidence.
  const slug = spec.migration.replace(/\.sql$/u, "")
  const options: Options = {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    // The shard's staging config is the TOP-LEVEL env (no named env); production
    // is `env.production`. Passing `--env staging` would not resolve.
    env: prod ? "production" : undefined,
    poolDb: prod ? "community-d1-shard-pool-prod" : "community-d1-shard-pool-staging",
    quarantineRegistry: resolve(get("--quarantines") ?? resolve(import.meta.dir, "../community-shard-quarantines.json")),
    prod,
    execute: argv.includes("--execute"),
    confirmTimeTravel: argv.includes("--confirm-time-travel"),
    allowNonMain: argv.includes("--allow-non-main"),
    repairQuarantinedOnly: argv.includes("--repair-quarantined-only"),
    repairLedgerWithoutObjects: argv.includes("--repair-ledger-without-objects"),
    manifest: resolve(get("--manifest") ?? `tmp/${slug}-${prod ? "prod" : "staging"}-manifest.json`),
    resumeFile: get("--resume-file") ? resolve(get("--resume-file")!) : undefined,
    only: get("--only"),
    concurrency: Number(get("--concurrency") ?? "8"),
    cwd: dirname(resolve(wranglerConfig)),
  }
  if (options.execute && !options.confirmTimeTravel) {
    throw new Error("--execute requires --confirm-time-travel (D1 Time Travel is the rollback path)")
  }
  if (options.execute && !options.resumeFile && !options.only) {
    throw new Error("--execute against the fleet requires --resume-file")
  }
  if (options.repairQuarantinedOnly && !options.only) {
    throw new Error("--repair-quarantined-only requires --only DB_NAME")
  }
  if (options.repairLedgerWithoutObjects && spec.repairLedgerWithoutObjects !== true) {
    throw new Error(`--repair-ledger-without-objects is not authorized by ${spec.migration}`)
  }
  // A concurrency of 0 (or NaN, from a typo) would spawn no workers, do no work,
  // and still write a clean-looking manifest.
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${get("--concurrency")}"`)
  }
  return options
}

export function selectMigrationBindings(input: {
  liveBindings: readonly string[]
  quarantinedTargets: readonly { binding: string; databaseName: string }[]
  only?: string
  repairQuarantinedOnly: boolean
}): { bindings: string[]; repairedQuarantineBinding?: string } {
  const quarantined = input.only
    ? input.quarantinedTargets.find((target) => target.databaseName === input.only)
    : undefined
  if (quarantined && !input.repairQuarantinedOnly) {
    throw new Error(`--only ${input.only} targets quarantined binding ${quarantined.binding}`)
  }
  if (input.repairQuarantinedOnly && !quarantined) {
    throw new Error(
      `--repair-quarantined-only target ${input.only} is not explicitly quarantined; refusing override`,
    )
  }
  return quarantined
    ? {
        bindings: [...input.liveBindings, quarantined.binding],
        repairedQuarantineBinding: quarantined.binding,
      }
    : { bindings: [...input.liveBindings] }
}

/**
 * The wrangler d1 execute transport. Exported (with `loadedBindings`/`shardMap`)
 * so the read-only fleet audit resolves the fleet through the exact same pool
 * query and binding resolution as a fleet migration — a second implementation
 * would eventually disagree about which shards are live.
 */
export async function wranglerJson(options: Pick<Options, "env" | "cwd">, db: string, args: string[]): Promise<any[]> {
  const cmd = [
    "bunx",
    "wrangler@4.100.0",
    "d1",
    "execute",
    db,
    ...(options.env ? ["--env", options.env] : []),
    "--remote",
    "--json",
    ...args,
  ]
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const proc = Bun.spawn(cmd, { cwd: options.cwd, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code === 0) return extractWranglerJson(stdout) as any[]
    const fullDetail = `${stderr}\n${stdout}`.trim()
    const detail = fullDetail.length > 800 ? fullDetail.slice(-800) : fullDetail
    if (!isTransientWranglerFailure(fullDetail) || attempt === 4) {
      throw new Error(`wrangler exited ${code}: ${detail}`)
    }
    await Bun.sleep(250 * 2 ** (attempt - 1))
  }
  throw new Error("wrangler retry loop exhausted")
}

export function isTransientWranglerFailure(detail: string): boolean {
  return /fetch failed|rate.?limit|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|code[^0-9]*7429|authentication error.*code[^0-9]*10000|network/isu.test(detail)
}

const READ_ONLY_MAX_ATTEMPTS = 7
const READ_ONLY_MAX_BACKOFF_MS = 8_000

/**
 * D1 occasionally returns 7500 while its query service is unhealthy. Retrying a
 * migration file after an ambiguous internal error could replay non-idempotent
 * DDL, so 7500 is intentionally handled only by this read-only wrapper.
 */
export function isTransientFleetReadFailure(detail: string): boolean {
  return isTransientWranglerFailure(detail) || /code[^0-9]*7500/isu.test(detail)
}

export function fleetReadRetryDelayMs(attempt: number, jitter = Math.random()): number {
  const exponential = Math.min(1_000 * 2 ** (attempt - 1), READ_ONLY_MAX_BACKOFF_MS)
  return exponential + Math.floor(Math.max(0, Math.min(jitter, 1)) * 500)
}

export async function retryTransientFleetRead<T>(
  operation: () => Promise<T>,
  sleep: (delayMs: number) => Promise<unknown> = Bun.sleep,
  jitter: () => number = Math.random,
): Promise<T> {
  for (let attempt = 1; attempt <= READ_ONLY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!isTransientFleetReadFailure(detail) || attempt === READ_ONLY_MAX_ATTEMPTS) throw error
      await sleep(fleetReadRetryDelayMs(attempt, jitter()))
    }
  }
  throw new Error("fleet read retry loop exhausted")
}

async function wranglerJsonReadOnly(
  options: Pick<Options, "env" | "cwd">,
  db: string,
  args: string[],
): Promise<any[]> {
  return retryTransientFleetRead(() => wranglerJson(options, db, args))
}

export async function loadedBindings(options: Pick<Options, "env" | "cwd" | "poolDb">): Promise<string[]> {
  const rows = (
    await wranglerJsonReadOnly(options, options.poolDb, [
      "--command",
      "SELECT binding_name FROM d1_pool WHERE community_id IS NOT NULL AND last_loaded_at IS NOT NULL ORDER BY binding_name",
    ])
  )[0].results as Array<{ binding_name: string }>
  return rows.map((r) => r.binding_name)
}

export async function shardMap(options: Pick<Options, "wranglerConfig" | "prod">): Promise<Map<string, { name: string; id: string }>> {
  const raw = (await readFile(options.wranglerConfig, "utf8")).replace(/^\s*\/\/.*$/gm, "")
  const config = JSON.parse(raw)
  const entries = options.prod ? config.env.production.d1_databases : config.d1_databases
  const map = new Map<string, { name: string; id: string }>()
  for (const e of entries) {
    if (e.binding.startsWith("DB_CMTY")) map.set(e.binding, { name: e.database_name, id: e.database_id })
  }
  return map
}

async function migrationSql(options: Options, spec: MigrationSpec): Promise<{ sql: string; checksum: string }> {
  const sql = await readFile(resolve(options.migrationsDir, spec.migration), "utf8")
  return { sql, checksum: createHash("sha256").update(sql).digest("hex") }
}

async function classify(
  options: Options,
  spec: MigrationSpec,
  target: { name: string; id: string },
  checksum: string,
  includeRowCounts = true,
): Promise<{ status: Status; detail?: string; row_counts?: Record<string, number> }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const countsSql = rowCountSql(spec)
  let rows: Record<string, number | string>
  let countRows: Record<string, number | string> | undefined
  let restClient: D1RestClient | undefined
  if (accountId && apiToken) {
    restClient = {
      accountId,
      apiToken,
      fetch,
      sleep: (milliseconds) => Bun.sleep(milliseconds),
    }
    const results = await d1QueryBatch(restClient, target, [classificationSql(spec)])
    rows = results[0]?.results?.[0] as Record<string, number | string>
    if (!rows) throw new Error("D1 REST classification returned no rows")
  } else {
    rows = (
      await wranglerJsonReadOnly(options, target.name, ["--command", classificationSql(spec)])
    )[0].results[0] as Record<string, number | string>
  }
  const classification = classifyRow(spec, rows, checksum)
  let rowCounts: Record<string, number> | undefined
  if (
    includeRowCounts &&
    countsSql &&
    spec.requiredTables.every((table) => Number(rows[`req_${table}`] ?? 0) === 1)
  ) {
    countRows = restClient
      ? (await d1QueryBatch(restClient, target, [countsSql]))[0]?.results?.[0] as Record<string, number | string>
      : (await wranglerJsonReadOnly(options, target.name, ["--command", countsSql]))[0].results[0] as Record<string, number | string>
    rowCounts = Object.fromEntries(
      (spec.rowCountTables ?? []).map((table) => [table, Number(countRows[`metric_rows__${table}`] ?? 0)]),
    )
  }
  return {
    ...classification,
    ...(rowCounts ? { row_counts: rowCounts } : {}),
  }
}

export function ledgerStatement(spec: MigrationSpec, checksum: string): string {
  return `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES ('${spec.migration}', '${spec.label}', '${checksum}');`
}

export function ledgerBackfillBody(spec: MigrationSpec, checksum: string): string {
  const repair = spec.ledgerBackfillSql?.trim()
  return `${repair ? `${repair}\n` : ""}${ledgerStatement(spec, checksum)}\n`
}

/**
 * The exact bytes sent to `wrangler d1 execute --file`.
 *
 * The migration SQL is TRUSTED and passed through VERBATIM — never parsed, split
 * or rewritten. An earlier version split on ";" and dropped any segment whose
 * trimmed text began with "--", which silently discarded the FIRST statement of any
 * migration that opens with a comment. 1127 survived only by accident (it starts
 * directly with `ALTER TABLE`); 1126 opens with a comment, so its `CREATE TABLE`
 * vanished and only the `CREATE INDEX` remained — which would have failed on all 93
 * shards. Comments are valid SQL and D1 accepts them; there is no reason to touch
 * the file.
 *
 * Schema + ledger go in ONE file: remote D1 rejects explicit BEGIN/COMMIT, but
 * wrangler applies a file with all-or-original semantics, so they move together and
 * a shard is never left with the objects but no ledger row.
 */
export function executionBody(sql: string, spec: MigrationSpec, checksum: string): string {
  return `${sql.trim()}\n${ledgerStatement(spec, checksum)}\n`
}

/**
 * Repair bytes for an exact ledger-without-objects state. The classifier has
 * already verified the recorded checksum, so the ledger is deliberately left
 * untouched while the original migration bytes restore the missing schema.
 */
export function ledgerWithoutObjectsRepairBody(sql: string): string {
  return `${sql.trim()}\n`
}

async function applyToShard(
  options: Options,
  spec: MigrationSpec,
  db: string,
  status: Status,
  sql: string,
  checksum: string,
): Promise<"applied_migration" | "backfilled_ledger" | "repaired_ledger_without_objects"> {
  if (status === "needs_ledger_backfill") {
    // Objects already exist. DO NOT replay the DDL — it would fail. A spec may
    // include a repeat-safe data repair before the ledger is recorded; keep the
    // repair and ledger write in the same uploaded file.
    const file = `/tmp/${spec.migration.split("_")[0]}-${db}-ledger-backfill.sql`
    await writeFile(file, ledgerBackfillBody(spec, checksum))
    await wranglerJson(options, db, ["--file", file])
    return "backfilled_ledger"
  }

  if (status === "needs_ledger_repair") {
    const file = `/tmp/${spec.migration.split("_")[0]}-${db}-ledger-without-objects-repair.sql`
    await writeFile(file, ledgerWithoutObjectsRepairBody(sql))
    await wranglerJson(options, db, ["--file", file])
    return "repaired_ledger_without_objects"
  }

  const file = `/tmp/${spec.migration.split("_")[0]}-${db}.sql`
  await writeFile(file, executionBody(sql, spec, checksum))
  await wranglerJson(options, db, ["--file", file])
  return "applied_migration"
}

/**
 * Resume-file entries are keyed by migration AND shard, tab-separated. Keying is
 * what makes ONE shared resume file safe across a multi-spec run: a shard done
 * for spec A must still be classified (and applied) for spec B. A bare
 * shard-only key would let spec B "complete" without touching the shard —
 * exactly the 2026-08-04 near-miss, where passes 2 and 3 of a three-spec run
 * reported empty summaries over a shard still missing five columns.
 */
export function resumeEntryKey(migration: string, shard: string): string {
  return `${migration}\t${shard}`
}

/**
 * The shard names a resume file marks done FOR THIS migration. Only keyed lines
 * whose migration part equals the current spec count. Bare shard-only lines
 * written by pre-keyed runners match NOTHING: they lose skip power rather than
 * being misparsed. That is safe — classification is idempotent and ok_recorded
 * shards are never re-written, so a stale entry's worst case is a
 * re-classification, never a skipped write.
 */
export function resumeDoneShards(fileContents: string, migration: string): Set<string> {
  const done = new Set<string>()
  for (const line of fileContents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const tab = trimmed.indexOf("\t")
    if (tab === -1) continue // legacy bare-name line: no skip power
    if (trimmed.slice(0, tab) === migration) done.add(trimmed.slice(tab + 1))
  }
  return done
}

export async function runFleetMigration(spec: MigrationSpec, scriptPath: string): Promise<void> {
  const options = parseArgs(spec, scriptPath)

  // Provenance chokepoint: every apply-* script flows through here, and BOTH
  // sides of the seam are attested — THIS core checkout (the script's repo
  // root) and the checkout containing --wrangler-config. Refusal happens before
  // any network call, let alone any shard write.
  const fleetProvenance = decideFleetProvenance({
    core: probeRolloutProvenance(resolve(import.meta.dir, "../../..")),
    config: probeConfigRepoProvenance(options.wranglerConfig),
    execute: options.execute,
    allowNonMain: options.allowNonMain,
  })
  if (!fleetProvenance.allow) throw new Error(fleetProvenance.reason)
  if (fleetProvenance.overrideUsed) {
    console.error(
      `\nWARNING: --allow-non-main break-glass override in effect (${fleetProvenance.overriddenSides.join(" + ")} side overridden):\n${fleetProvenance.reason}\n`,
    )
  } else {
    console.log(`provenance: ${fleetProvenance.reason}`)
  }
  // A read-only pass never blocks — but a stale config on a dry run produces a
  // confidently wrong report (26 of ~205 bindings once looked like the whole
  // fleet), so a config-side anomaly gets a loud warning, not a quiet log line.
  if (!options.execute && fleetProvenance.configFailure !== null) {
    console.error(`\nWARNING config provenance: ${fleetProvenance.configFailure}\n`)
  }

  const { sql, checksum } = await migrationSql(options, spec)
  const map = await shardMap(options)

  const allocatedBindings = await loadedBindings(options)
  // The pool is authoritative for "which shards are live". If it is empty, our
  // view of the fleet is broken — never treat that as "no work to do".
  if (allocatedBindings.length === 0) {
    throw new Error(
      `${options.poolDb} reported ZERO allocated+loaded shards. That is not a no-op — it means the pool query or environment is wrong. Refusing to continue.`,
    )
  }
  const partition = await partitionQuarantinedBindings(
    options.quarantineRegistry,
    options.prod ? "production" : "staging",
    allocatedBindings,
    new Set(map.keys()),
  )
  const selection = selectMigrationBindings({
    liveBindings: partition.live,
    quarantinedTargets: partition.quarantined.flatMap((entry) => {
      const databaseName = map.get(entry.binding)?.name
      return databaseName ? [{ binding: entry.binding, databaseName }] : []
    }),
    only: options.only,
    repairQuarantinedOnly: options.repairQuarantinedOnly,
  })
  const bindings = selection.bindings
  if (bindings.length === 0) throw new Error("quarantine policy leaves ZERO live shards; refusing to continue")

  const targets: Array<{ binding: string; name: string; id: string }> = []
  // A binding that is allocated in the pool but absent from the shard config is
  // NOT skippable: that is exactly how a stale config once hid live shards from a
  // fleet migration. Record it as blocking and fail the run.
  const missingFromConfig: ShardResult[] = []
  for (const b of bindings) {
    const entry = map.get(b)
    if (!entry) {
      missingFromConfig.push({
        binding: b,
        database_name: "(unknown — not in shard config)",
        database_id: "(unknown)",
        status: "missing_from_config",
        action: "none",
        detail: `allocated+loaded in ${options.poolDb} but absent from ${options.wranglerConfig}. The config is stale or wrong — resolve it from a clean origin/main checkout.`,
      })
      continue
    }
    if (options.only && entry.name !== options.only) continue
    targets.push({ binding: b, name: entry.name, id: entry.id })
  }

  if (options.only && targets.length !== 1) {
    throw new Error(
      `--only ${options.only} matched ${targets.length} shards among the allocated+loaded set; expected exactly 1. Check the name and the --prod flag.`,
    )
  }

  let done = new Set<string>()
  if (options.resumeFile) {
    try {
      done = resumeDoneShards(await readFile(options.resumeFile, "utf8"), spec.migration)
    } catch {
      /* first run */
    }
  }

  console.log(
    `fleet=${options.prod ? "PRODUCTION" : "staging"}  migration=${spec.migration}  checksum=${checksum.slice(0, 12)}`,
  )
  console.log(
    `allocated+loaded: ${allocatedBindings.length}  live: ${bindings.length}  quarantined: ${partition.quarantined.length}  (already done: ${done.size})  mode=${options.execute ? "EXECUTE" : "DRY RUN (read-only)"}`,
  )

  const results: ShardResult[] = []
  const pending = targets.filter((t) => !done.has(t.name))
  let idx = 0

  async function worker() {
    while (idx < pending.length) {
      const t = pending[idx++]
      const base = { binding: t.binding, database_name: t.name, database_id: t.id }
      try {
        const classificationStartedAt = performance.now()
        const initial = await classify(options, spec, t, checksum)
        let status = planLedgerWithoutObjectsRepair(
          spec,
          initial.status,
          options.repairLedgerWithoutObjects,
        )
        let detail = initial.detail
        const row_counts = initial.row_counts
        const classificationDurationMs = Math.round(performance.now() - classificationStartedAt)
        let action: ShardResult["action"] = "none"
        let applyDurationMs: number | undefined
        const writable =
          status === "needs_migration" ||
          status === "needs_ledger_backfill" ||
          status === "needs_ledger_repair"
        if (options.execute && writable) {
          const applyStartedAt = performance.now()
          action = await applyToShard(options, spec, t.name, status, sql, checksum)
          applyDurationMs = Math.round(performance.now() - applyStartedAt)
          if (action === "repaired_ledger_without_objects") {
            const verified = await classify(options, spec, t, checksum, false)
            if (verified.status !== "ok_recorded") {
              throw new Error(
                `post-repair verification failed: ${verified.status}${verified.detail ? ` — ${verified.detail}` : ""}`,
              )
            }
            status = verified.status
            detail = `repaired exact ledger-without-objects state for ${spec.migration}`
          }
          // Append the instant it lands, so a transient failure on a LATER shard
          // can never lose the record of this one. Keyed by migration AND shard:
          // another spec's entries must never satisfy this run.
          if (options.resumeFile) {
            await writeFile(options.resumeFile, `${resumeEntryKey(spec.migration, t.name)}\n`, { flag: "a" })
          }
        }
        results.push({
          ...base,
          status,
          action,
          ...(row_counts ? { row_counts } : {}),
          classification_duration_ms: classificationDurationMs,
          ...(applyDurationMs === undefined ? {} : { apply_duration_ms: applyDurationMs }),
          ...(detail ? { detail } : {}),
        })
        console.log(`  ${t.name.padEnd(34)} ${status}${action !== "none" ? ` -> ${action}` : ""}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        results.push({ ...base, status: "error", action: "none", detail })
        console.error(`  ${t.name.padEnd(34)} error: ${detail}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(pending.length, 1)) }, worker))

  // Shards absent from the config never got classified — they must still surface.
  results.push(...missingFromConfig)

  const summary: Record<string, number> = {}
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1

  const skippedByResume = targets.length - pending.length

  await mkdir(dirname(options.manifest), { recursive: true })
  await writeFile(
    options.manifest,
    `${JSON.stringify(
      {
        fleet: options.prod ? "production" : "staging",
        migration: spec.migration,
        checksum,
        executed: options.execute,
        // Checkout provenance: which git state produced this run, on BOTH sides
        // of the seam (executing core checkout + the config's own checkout).
        // overriddenSides lists which side(s) a break-glass --allow-non-main
        // execution actually overrode.
        rollout_provenance: fleetProvenance.coreRecord,
        config_provenance: fleetProvenance.configRecord,
        // Provenance: which config decided the fleet's membership. A stale config
        // here is the difference between migrating the fleet and migrating a slice.
        shard_config: options.wranglerConfig,
        shard_config_bindings: map.size,
        pool_db: options.poolDb,
        allocated_loaded_shards: allocatedBindings.length,
        live_shards: bindings.length,
        quarantined_shards: partition.quarantined.length,
        quarantine_registry: options.quarantineRegistry,
        quarantine_registry_checksum: partition.registryChecksum,
        quarantines: partition.quarantined,
        quarantine_repair_override: selection.repairedQuarantineBinding
          ? {
              binding: selection.repairedQuarantineBinding,
              database_name: options.only,
            }
          : null,
        ledger_without_objects_repair: {
          requested: options.repairLedgerWithoutObjects,
          authorized_by_spec: spec.repairLedgerWithoutObjects === true,
        },
        classified: results.length - skippedByResume,
        skipped_by_resume_file: skippedByResume,
        // A resume file skips shards WITHOUT reclassifying them, so a run that used
        // one is an execution record, not proof of final state.
        is_full_verification: !options.resumeFile && !options.only,
        summary,
        shards: results,
      },
      null,
      2,
    )}\n`,
  )

  console.log("\nsummary:", JSON.stringify(summary))
  console.log(`manifest: ${options.manifest}`)

  const blocking = results.filter((r) => BLOCKING_STATUSES.includes(r.status))
  if (blocking.length > 0) {
    console.error(`\n${blocking.length} shard(s) need human review — refusing to report success:`)
    for (const b of blocking) console.error(`  ${b.database_name} [${b.binding}]: ${b.status} — ${b.detail ?? ""}`)
    process.exit(2)
  }

  if (options.execute) {
    console.log(
      "\nEXECUTION COMPLETE. This run used a resume file and/or --only, so it is an execution\n" +
        "record, NOT proof of final state. Re-run WITHOUT --execute, --resume-file or --only to\n" +
        "obtain a full read-only verification of the fleet before declaring this done.",
    )
  } else {
    const todo = results.filter(
      (r) =>
        r.status === "needs_migration" ||
        r.status === "needs_ledger_backfill" ||
        r.status === "needs_ledger_repair",
    )
    if (!options.resumeFile && !options.only && todo.length === 0) {
      console.log(`\nFULL VERIFICATION: all ${results.length} allocated+loaded shards are ok_recorded.`)
    } else {
      console.log(`\ndry run: ${todo.length} shard(s) would be written. Re-run with --execute --confirm-time-travel.`)
    }
  }
}
