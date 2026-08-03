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
 *   an unrecorded tail: completed shards are appended as they land.
 * - The pool is authoritative for fleet membership. Zero allocated shards is an
 *   error, never "no work to do".
 * - A shard allocated in the pool but absent from the shard config is BLOCKING,
 *   never skippable — that is exactly how a stale config once hid live shards
 *   from a fleet migration.
 * - Anything not positively understood (partial objects, ledger present but
 *   objects absent, checksum mismatch) is reported and NOT written to.
 * - Schema + ledger move together in one file, so a shard is never left with the
 *   objects but no ledger row (or vice versa).
 * - A run that used `--resume-file` or `--only` is an execution record, NOT proof
 *   of final state. Only a clean read-only pass over the whole fleet proves that.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { partitionQuarantinedBindings } from "./community-shard-quarantine"

/** The schema objects a migration creates. Presence is how a shard is classified. */
export type ObjectSpec =
  | { kind: "columns"; table: string; columns: readonly string[] }
  | { kind: "columns_by_table"; columns: readonly { table: string; column: string }[] }
  | { kind: "table_sql_contains"; table: string; fragments: readonly string[] }
  | {
      kind: "schema_objects"
      columns: readonly { table: string; column: string }[]
      indexes: readonly string[]
    }
  | { kind: "tables"; tables: readonly string[] }

export type MigrationSpec = {
  /** File name inside the migrations dir, e.g. "1126_reward_qualification_outbox.sql". */
  migration: string
  /** Ledger label, e.g. "community-template". */
  label: string
  /** Tables that must already exist for this migration to be applicable at all. */
  requiredTables: readonly string[]
  /** What the migration creates. */
  creates: ObjectSpec
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
  /** Short human description used in --help. */
  description: string
}

export type Status =
  | "ok_recorded" // ledger + all objects, checksum matches -> nothing to do
  | "needs_migration" // no ledger, no objects -> apply DDL + ledger
  | "needs_ledger_backfill" // objects present, ledger missing -> ledger INSERT only
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
  action: "none" | "applied_migration" | "backfilled_ledger"
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
          ].join(",\n  ")
        : spec.creates.tables
          .map((t) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}') AS obj_${t}`)
          .join(",\n  ")

  return `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_ledger,
  (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${spec.migration}') AS ledger_checksum,
  ${required},
  ${objects}`
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
    ]
  }
  return spec.creates.tables
}

function cell(r: Record<string, number | string>, key: string): number | string {
  return r[key] ?? 0
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

  const names = objectNames(spec)
  const present = names.filter((n) => Number(cell(rows, `obj_${n}`)) === 1)
  const recorded = String(rows.ledger_checksum ?? "")

  if (present.length > 0 && present.length < names.length) {
    return { status: "partial_objects", detail: `present: ${present.join(", ")}` }
  }
  const allPresent = present.length === names.length

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
  --resume-file PATH       Record completed shards; re-runs skip them.
  --concurrency N          Default 8.
  --execute                Write. Without it, this is a read-only dry run.
  --confirm-time-travel    Required with --execute.

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
  // A concurrency of 0 (or NaN, from a typo) would spawn no workers, do no work,
  // and still write a clean-looking manifest.
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${get("--concurrency")}"`)
  }
  return options
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
  const proc = Bun.spawn(cmd, { cwd: options.cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`wrangler exited ${code}: ${stderr.slice(0, 400)}`)
  return extractWranglerJson(stdout) as any[]
}

export async function loadedBindings(options: Pick<Options, "env" | "cwd" | "poolDb">): Promise<string[]> {
  const rows = (
    await wranglerJson(options, options.poolDb, [
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
  db: string,
  checksum: string,
): Promise<{ status: Status; detail?: string }> {
  const rows = (
    await wranglerJson(options, db, ["--command", classificationSql(spec)])
  )[0].results[0] as Record<string, number | string>
  return classifyRow(spec, rows, checksum)
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

async function applyToShard(
  options: Options,
  spec: MigrationSpec,
  db: string,
  status: Status,
  sql: string,
  checksum: string,
): Promise<"applied_migration" | "backfilled_ledger"> {
  if (status === "needs_ledger_backfill") {
    // Objects already exist. DO NOT replay the DDL — it would fail. A spec may
    // include a repeat-safe data repair before the ledger is recorded; keep the
    // repair and ledger write in the same uploaded file.
    const file = `/tmp/${spec.migration.split("_")[0]}-${db}-ledger-backfill.sql`
    await writeFile(file, ledgerBackfillBody(spec, checksum))
    await wranglerJson(options, db, ["--file", file])
    return "backfilled_ledger"
  }

  const file = `/tmp/${spec.migration.split("_")[0]}-${db}.sql`
  await writeFile(file, executionBody(sql, spec, checksum))
  await wranglerJson(options, db, ["--file", file])
  return "applied_migration"
}

export async function runFleetMigration(spec: MigrationSpec, scriptPath: string): Promise<void> {
  const options = parseArgs(spec, scriptPath)
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
  const bindings = partition.live
  if (bindings.length === 0) throw new Error("quarantine policy leaves ZERO live shards; refusing to continue")
  if (options.only) {
    const quarantined = partition.quarantined.find((q) => map.get(q.binding)?.name === options.only)
    if (quarantined) throw new Error(`--only ${options.only} targets quarantined binding ${quarantined.binding}`)
  }

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

  const done = new Set<string>()
  if (options.resumeFile) {
    try {
      for (const line of (await readFile(options.resumeFile, "utf8")).split("\n")) {
        if (line.trim()) done.add(line.trim())
      }
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
        const { status, detail } = await classify(options, spec, t.name, checksum)
        let action: ShardResult["action"] = "none"
        const writable = status === "needs_migration" || status === "needs_ledger_backfill"
        if (options.execute && writable) {
          action = await applyToShard(options, spec, t.name, status, sql, checksum)
          // Append the instant it lands, so a transient failure on a LATER shard
          // can never lose the record of this one.
          if (options.resumeFile) await writeFile(options.resumeFile, `${t.name}\n`, { flag: "a" })
        }
        results.push({ ...base, status, action, ...(detail ? { detail } : {}) })
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
    const todo = results.filter((r) => r.status === "needs_migration" || r.status === "needs_ledger_backfill")
    if (!options.resumeFile && !options.only && todo.length === 0) {
      console.log(`\nFULL VERIFICATION: all ${results.length} allocated+loaded shards are ok_recorded.`)
    } else {
      console.log(`\ndry run: ${todo.length} shard(s) would be written. Re-run with --execute --confirm-time-travel.`)
    }
  }
}
