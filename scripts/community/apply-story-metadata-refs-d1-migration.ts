/**
 * Operator script: apply community-template migration 1127_asset_story_metadata_refs.sql
 * across the ALLOCATED + LOADED community D1 shards.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pinned API (`commerce/queries.ts`, api #425 / core #135) writes
 * `assets.story_ip_metadata_uri`. That column is added by community-template
 * migration 1127, which is applied per-community — and nothing in the release
 * pipeline applies community-template migrations to the fleet. The result was
 * code-ahead-of-schema: every publish failed with
 *
 *   D1_ERROR: no such column: story_ip_metadata_uri
 *
 * The blocking multipart release gate caught it on staging (run 29332556154)
 * and correctly held production.
 *
 * SAFETY MODEL
 * ------------
 * - Default is READ-ONLY classification. `--execute` is required to write.
 * - Only ALLOCATED + LOADED shards are targeted. Blank, never-loaded pool
 *   databases are skipped: bootstrap applies the latest schema when they are
 *   allocated, so migrating them here is both unnecessary and risky.
 * - 1127 is plain `ALTER TABLE ... ADD COLUMN`, so REPLAYING it against a shard
 *   that already has the columns FAILS ("duplicate column name"). We therefore
 *   classify first and, where the columns already exist but the ledger row is
 *   missing, we backfill the LEDGER ONLY — never the DDL.
 * - Schema + ledger move together: the ledger INSERT is placed in the same SQL
 *   file as the DDL. Remote D1 rejects explicit BEGIN/COMMIT in uploaded files,
 *   but wrangler executes a file with all-or-original semantics, so this is the
 *   established atomicity pattern (see apply-song-study-ga-d1-migrations.ts).
 * - Resumable: completed shards are recorded in --resume-file and skipped.
 * - Every shard's outcome is written to the result artifact.
 *
 * Anything we do not positively understand (partial columns, ledger present but
 * columns absent, checksum mismatch) is reported and NOT written to.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { type Artifacts, expectedArtifacts, extractWranglerJson } from "./community-shard-schema"

// Re-exported: existing callers and tests import this from here.
export { extractWranglerJson }

const DEFAULT_MIGRATION = "1127_asset_story_metadata_refs.sql"
let MIGRATION = DEFAULT_MIGRATION
const MIGRATION_LABEL = "community-template"

type Status =
  | "ok_recorded" // ledger + all columns, checksum matches -> nothing to do
  | "needs_migration" // no ledger, no columns -> apply DDL + ledger
  | "needs_ledger_backfill" // columns present, ledger missing -> ledger INSERT only
  | "checksum_mismatch" // ledger records a DIFFERENT 1127 -> refuse
  | "ledger_without_columns" // ledger says applied, columns absent -> refuse
  | "partial_columns" // some columns only -> refuse
  | "schema_not_ready" // no assets / no schema_migrations table -> refuse
  | "missing_from_config" // allocated in the pool but absent from the shard config -> refuse
  | "error"

/**
 * Statuses that mean "we do not positively understand this shard". ANY of these
 * fails the run. `missing_from_config` and `schema_not_ready` are here because
 * silently skipping them is precisely how a stale shard config once hid 178 live
 * shards from a fleet migration.
 */
const BLOCKING_STATUSES: readonly Status[] = [
  "checksum_mismatch",
  "ledger_without_columns",
  "partial_columns",
  "schema_not_ready",
  "missing_from_config",
  "error",
]


type ShardResult = {
  binding: string
  database_name: string
  database_id: string
  status: Status
  action: "none" | "applied_migration" | "backfilled_ledger"
  detail?: string
}

type Options = {
  migration: string
  wranglerConfig: string
  migrationsDir: string
  env?: string
  poolDb: string
  prod: boolean
  execute: boolean
  confirmTimeTravel: boolean
  manifest: string
  resumeFile?: string
  only?: string
  concurrency: number
  cwd: string
}

function usage(): never {
  console.error(`
Apply community-template ${MIGRATION} across allocated+loaded community shards.

  bun scripts/community/apply-story-metadata-refs-d1-migration.ts \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc [options]

Options:
  --wrangler-config PATH   Shard wrangler.jsonc (lives in the api repo).
  --migrations-dir PATH    Default: db/community-template/migrations
  --prod                   Target the production fleet. Default: staging.
  --only DB_NAME           Canary a single database.
  --manifest PATH          Write the classification manifest / results here.
  --resume-file PATH       Record completed shards; re-runs skip them.
  --concurrency N          Default 8.
  --execute                Write. Without it, this is a read-only dry run.
  --confirm-time-travel    Required with --execute.

Read-only by default. Blank, never-loaded pool databases are never touched.
`)
  process.exit(1)
}

function parseArgs(): Options {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const prod = argv.includes("--prod")
  const wranglerConfig = get("--wrangler-config")
  if (!wranglerConfig) usage()
  const options: Options = {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    // The shard's staging config is the TOP-LEVEL env (no named env); production
    // is `env.production`. Passing `--env staging` would not resolve.
    env: prod ? "production" : undefined,
    poolDb: prod ? "community-d1-shard-pool-prod" : "community-d1-shard-pool-staging",
    prod,
    execute: argv.includes("--execute"),
    confirmTimeTravel: argv.includes("--confirm-time-travel"),
    manifest: resolve(get("--manifest") ?? `tmp/1127-${prod ? "prod" : "staging"}-manifest.json`),
    resumeFile: get("--resume-file") ? resolve(get("--resume-file")!) : undefined,
    migration: get("--migration") ?? DEFAULT_MIGRATION,
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

async function wranglerJson(options: Options, db: string, args: string[]): Promise<any[]> {
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
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  if (proc.exitCode !== 0) throw new Error(`wrangler d1 execute ${db} failed: ${err.trim()}`)
  try {
    return extractWranglerJson(out) as any[]
  } catch (error) {
    throw new Error(
      `wrangler d1 execute ${db} returned unparseable output: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Allocated AND loaded bindings only — a loaded shard is a real community. */
async function loadedBindings(options: Options): Promise<string[]> {
  const rows = (
    await wranglerJson(options, options.poolDb, [
      "--command",
      "SELECT binding_name FROM d1_pool WHERE community_id IS NOT NULL AND last_loaded_at IS NOT NULL ORDER BY binding_name",
    ])
  )[0].results as Array<{ binding_name: string }>
  return rows.map((r) => r.binding_name)
}

async function shardMap(options: Options): Promise<Map<string, { name: string; id: string }>> {
  const raw = (await readFile(options.wranglerConfig, "utf8")).replace(/^\s*\/\/.*$/gm, "")
  const config = JSON.parse(raw)
  const entries = options.prod ? config.env.production.d1_databases : config.d1_databases
  const map = new Map<string, { name: string; id: string }>()
  for (const e of entries) {
    if (e.binding.startsWith("DB_CMTY")) map.set(e.binding, { name: e.database_name, id: e.database_id })
  }
  return map
}

async function migrationSql(options: Options): Promise<{ sql: string; checksum: string }> {
  const sql = await readFile(resolve(options.migrationsDir, MIGRATION), "utf8")
  return { sql, checksum: createHash("sha256").update(sql).digest("hex") }
}

async function classify(
  options: Options,
  db: string,
  checksum: string,
  artifacts: Artifacts,
): Promise<{ status: Status; detail?: string }> {
  // Artifacts come from the migration SQL, so this works for ANY community-template
  // migration — not just 1127. `altered` tables must already exist for an ALTER to
  // apply; if one is missing the shard is not ready and we refuse rather than guess.
  const checks = [
    ...artifacts.tables.map(
      (t, i) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}') AS t${i}`,
    ),
    ...artifacts.columns.map(
      ([t, c], i) => `(SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE name='${c}') AS c${i}`,
    ),
    ...artifacts.altered.map(
      (t, i) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${t}') AS base${i}`,
    ),
  ]
  const rows = (
    await wranglerJson(options, db, [
      "--command",
      `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_ledger,
  (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${MIGRATION}') AS ledger_checksum${checks.length ? ",\n  " + checks.join(",\n  ") : ""}`,
    ])
  )[0].results[0] as Record<string, number | string>

  if (Number(row(rows, "has_ledger")) !== 1) {
    return { status: "schema_not_ready", detail: "schema_migrations table absent" }
  }
  const missingBase = artifacts.altered.filter((_, i) => Number(row(rows, `base${i}`)) !== 1)
  if (missingBase.length > 0) {
    return { status: "schema_not_ready", detail: `base table(s) absent: ${missingBase.join(", ")}` }
  }

  const total = artifacts.tables.length + artifacts.columns.length
  const present =
    artifacts.tables.filter((_, i) => Number(row(rows, `t${i}`)) === 1).length +
    artifacts.columns.filter((_, i) => Number(row(rows, `c${i}`)) === 1).length
  const recorded = String(rows.ledger_checksum ?? "")

  if (present > 0 && present < total) {
    return { status: "partial_columns", detail: `${present}/${total} artifacts present` }
  }
  const allPresent = total > 0 && present === total

  if (recorded) {
    if (recorded !== checksum) {
      return { status: "checksum_mismatch", detail: `ledger=${recorded.slice(0, 12)} expected=${checksum.slice(0, 12)}` }
    }
    return allPresent
      ? { status: "ok_recorded" }
      : { status: "ledger_without_columns", detail: `ledger records ${MIGRATION} but its schema is absent` }
  }
  // No ledger row. ADD COLUMN / CREATE TABLE migrations cannot be blindly replayed
  // (ADD COLUMN fails with "duplicate column name"), so where the schema already
  // exists we backfill the LEDGER ONLY.
  return allPresent ? { status: "needs_ledger_backfill" } : { status: "needs_migration" }
}

function row(r: Record<string, number | string>, key: string): number | string {
  return r[key] ?? 0
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"))
}

async function applyToShard(
  options: Options,
  db: string,
  status: Status,
  sql: string,
  checksum: string,
): Promise<"applied_migration" | "backfilled_ledger"> {
  const ledger = `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES ('${MIGRATION}', '${MIGRATION_LABEL}', '${checksum}');`

  if (status === "needs_ledger_backfill") {
    // Columns already exist. DO NOT replay the DDL — it would fail. Ledger only.
    await wranglerJson(options, db, ["--command", ledger])
    return "backfilled_ledger"
  }

  // Schema + ledger in ONE file: remote D1 rejects explicit BEGIN/COMMIT, but
  // wrangler applies a file with all-or-original semantics, so they move together.
  const body = splitStatements(sql).join(";\n") + ";"
  const file = `/tmp/1127-${db}.sql`
  await writeFile(file, `${body}\n${ledger}\n`)
  await wranglerJson(options, db, ["--file", file])
  return "applied_migration"
}

async function main() {
  const options = parseArgs()
  MIGRATION = options.migration
  const { sql, checksum } = await migrationSql(options)
  const artifacts = expectedArtifacts(sql)
  const map = await shardMap(options)

  const bindings = await loadedBindings(options)
  // The pool is authoritative for "which shards are live". If it is empty, our
  // view of the fleet is broken — never treat that as "no work to do".
  if (bindings.length === 0) {
    throw new Error(
      `${options.poolDb} reported ZERO allocated+loaded shards. That is not a no-op — it means the pool query or environment is wrong. Refusing to continue.`,
    )
  }

  const targets: Array<{ binding: string; name: string; id: string }> = []
  // A binding that is allocated in the pool but absent from the shard config is
  // NOT skippable: that is exactly how a stale config once hid 178 live shards
  // from a fleet migration. Record it as blocking and fail the run.
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
    `fleet=${options.prod ? "PRODUCTION" : "staging"}  migration=${MIGRATION}  checksum=${checksum.slice(0, 12)}`,
  )
  console.log(`allocated+loaded shards: ${targets.length}  (already done: ${done.size})  mode=${options.execute ? "EXECUTE" : "DRY RUN (read-only)"}`)

  const results: ShardResult[] = []
  const pending = targets.filter((t) => !done.has(t.name))
  let idx = 0

  async function worker() {
    while (idx < pending.length) {
      const t = pending[idx++]
      const base = { binding: t.binding, database_name: t.name, database_id: t.id }
      try {
        const { status, detail } = await classify(options, t.name, checksum, artifacts)
        let action: ShardResult["action"] = "none"
        const writable = status === "needs_migration" || status === "needs_ledger_backfill"
        if (options.execute && writable) {
          action = await applyToShard(options, t.name, status, sql, checksum)
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
        migration: MIGRATION,
        checksum,
        executed: options.execute,
        // Provenance: which config decided the fleet's membership. A stale config
        // here is the difference between migrating 205 shards and migrating 26.
        shard_config: options.wranglerConfig,
        shard_config_bindings: map.size,
        pool_db: options.poolDb,
        allocated_loaded_shards: targets.length + missingFromConfig.length,
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

// Only run when invoked directly, so the pure helpers above stay unit-testable.
if (import.meta.main) await main()
