#!/usr/bin/env bun
/**
 * Single-shard repair: converge DB_CMTY_0068's partially-applied
 * 1108_booking_settlement_review.sql.
 *
 * The incident (ground-truthed against prod on 2026-08-04)
 * --------------------------------------------------------
 * community-d1-pool-0068-prod has SIX of 1108's nine columns plus its index
 * idx_bookings_settlement_review_pending, and its schema_migrations row already
 * carries the CURRENT file's sha256. Missing exactly:
 *
 *   settlement_review_operator_actor_id TEXT
 *   settlement_review_note TEXT
 *   settlement_review_version INTEGER NOT NULL DEFAULT 0 CHECK (settlement_review_version >= 0)
 *
 * The fleet replay tool cannot do this repair: replaying the file dies on
 * duplicate-column for the six present ones, and the shared classifier reports
 * ledger_without_objects — a BLOCKING status. A full cohort sweep found this
 * shard unique, so this is a one-shard, introspection-driven convergence:
 * emit ALTER TABLE ADD COLUMN only for the columns the probe finds missing,
 * never DROP, never UPDATE rows, never touch schema_migrations (the ledger
 * checksum already matches; after the columns land, objects match the ledger
 * and no ledger write is needed or wanted).
 *
 * Safety shape (same as the fleet runner)
 * ---------------------------------------
 * - Dry-run by default: prints the probe and the planned statements, writes the
 *   manifest, exits 0. `--execute` requires `--confirm-time-travel`.
 * - origin/main provenance gate (lib/rollout-provenance.ts): --execute refuses
 *   unless HEAD is contained in the local origin/main ref and the tree is clean;
 *   --allow-non-main is a loud, manifest-recorded break-glass. Read-only runs
 *   never block but still record provenance.
 * - Fail-closed guards: a missing 1108 ledger row, a checksum that differs from
 *   the current file, a missing index, or a missing bookings table are all a
 *   DIFFERENT repair — this script refuses, it never improvises.
 * - After writing, it re-probes and REQUIRES all nine columns + the index
 *   present with the ledger checksum still matching, else exits 1 loudly.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"

const MIGRATION = "1108_booking_settlement_review.sql"
const EXPECTED_COLUMN_COUNT = 9

export type SettlementReviewColumn = {
  name: string
  /** The ALTER TABLE statement, verbatim from the migration file. */
  statement: string
}

/**
 * The repair shape, parsed from the REAL migration file (never hardcoded): the
 * nine ADD COLUMN statements in file order and the index name. Fails closed if
 * the file no longer matches the shape this script was reviewed for.
 */
export function parseSettlementReviewMigration(sql: string): {
  columns: SettlementReviewColumn[]
  indexName: string
} {
  const columns: SettlementReviewColumn[] = []
  const alter = /ALTER\s+TABLE\s+bookings\s+ADD\s+COLUMN\s+(\w+)[^;]*;/giu
  let match: RegExpExecArray | null
  while ((match = alter.exec(sql)) !== null) {
    columns.push({ name: match[1], statement: match[0].trim() })
  }
  if (columns.length !== EXPECTED_COLUMN_COUNT) {
    throw new Error(
      `${MIGRATION}: expected exactly ${EXPECTED_COLUMN_COUNT} ALTER TABLE bookings ADD COLUMN statements, ` +
        `parsed ${columns.length} — the file changed; this repair needs a reviewed script change`,
    )
  }
  const index = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/iu)
  if (!index) throw new Error(`${MIGRATION}: CREATE INDEX not found`)
  return { columns, indexName: index[1] }
}

export function settlementReviewProbeSql(indexName: string): string {
  return `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='bookings') AS has_bookings,
  (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${MIGRATION}') AS ledger_checksum,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${indexName}') AS has_index,
  (SELECT json_group_array(name) FROM pragma_table_info('bookings')) AS bookings_columns`
}

export type RepairProbe = {
  hasBookings: boolean
  /** "" when the 1108 ledger row is absent. */
  ledgerChecksum: string
  hasIndex: boolean
  presentColumns: ReadonlySet<string>
}

/** Row shape shared by the wrangler transport and the bun:sqlite test probe. */
export function probeFromRow(row: Record<string, unknown>): RepairProbe {
  return {
    hasBookings: Number(row.has_bookings ?? 0) === 1,
    ledgerChecksum: String(row.ledger_checksum ?? ""),
    hasIndex: Number(row.has_index ?? 0) === 1,
    presentColumns: new Set(JSON.parse(String(row.bookings_columns ?? "[]")) as string[]),
  }
}

export type RepairPlan =
  | { kind: "refuse"; reason: string }
  | { kind: "converged" }
  | { kind: "repair"; missing: string[]; statements: string[] }

/** Pure guard + plan over an already-fetched probe. Unit-testable without a fleet. */
export function planSettlementReviewRepair(input: {
  checksum: string
  columns: readonly SettlementReviewColumn[]
  indexName: string
  probe: RepairProbe
}): RepairPlan {
  const { probe } = input
  if (!probe.hasBookings) {
    return { kind: "refuse", reason: "bookings table is absent — that is a different repair, not this one" }
  }
  if (!probe.ledgerChecksum) {
    return {
      kind: "refuse",
      reason: `no ledger row for ${MIGRATION} — a shard that never recorded the migration is a different repair, not this one`,
    }
  }
  if (probe.ledgerChecksum !== input.checksum) {
    return {
      kind: "refuse",
      reason:
        `ledger checksum for ${MIGRATION} is ${probe.ledgerChecksum.slice(0, 12)}, expected ${input.checksum.slice(0, 12)} ` +
        "(the current file) — a ledger recording different bytes is a different repair, not this one",
    }
  }
  if (!probe.hasIndex) {
    return {
      kind: "refuse",
      reason: `index ${input.indexName} is absent — the partial state this script converges includes the index; refuse to improvise`,
    }
  }
  const missing = input.columns.filter((column) => !probe.presentColumns.has(column.name))
  if (missing.length === 0) return { kind: "converged" }
  return { kind: "repair", missing: missing.map((c) => c.name), statements: missing.map((c) => c.statement) }
}

/** Post-write verification: every column + the index present, ledger untouched. */
export function convergenceFailures(input: {
  checksum: string
  columns: readonly SettlementReviewColumn[]
  indexName: string
  probe: RepairProbe
}): string[] {
  const failures: string[] = []
  for (const column of input.columns) {
    if (!input.probe.presentColumns.has(column.name)) failures.push(`column still missing: ${column.name}`)
  }
  if (!input.probe.hasIndex) failures.push(`index still missing: ${input.indexName}`)
  if (input.probe.ledgerChecksum !== input.checksum) {
    failures.push(`ledger checksum changed: ${input.probe.ledgerChecksum.slice(0, 12)} != ${input.checksum.slice(0, 12)}`)
  }
  return failures
}

type Options = {
  wranglerConfig: string
  migrationsDir: string
  prod: boolean
  env?: string
  only: string
  manifest: string
  execute: boolean
  confirmTimeTravel: boolean
  allowNonMain: boolean
  cwd: string
}

function usage(scriptPath: string): never {
  console.error(`
Converge a single shard's partially-applied ${MIGRATION} (the DB_CMTY_0068 repair).
Emits ALTER TABLE bookings ADD COLUMN only for columns the probe finds missing.
Never DROPs, never UPDATEs rows, never touches schema_migrations.

  bun ${scriptPath} \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc --only DB_NAME [options]

Options:
  --wrangler-config PATH   Shard wrangler.jsonc (lives in the api repo).
  --only DB_NAME           REQUIRED: the single database to repair.
  --migrations-dir PATH    Default: db/community-template/migrations
  --prod                   Target the production fleet config. Default: staging.
  --manifest PATH          Write the probe/plan/result record here.
  --execute                Write. Without it, this is a read-only dry run.
  --confirm-time-travel    Required with --execute.
  --allow-non-main         Break-glass: allow --execute from a HEAD that is not
                           contained in origin/main (loud warning; recorded).

Dry-run by default. Guards refuse loudly rather than improvise.
`)
  process.exit(1)
}

function parseArgs(scriptPath: string): Options {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const wranglerConfig = get("--wrangler-config")
  const only = get("--only")
  if (!wranglerConfig || !only) usage(scriptPath)
  const prod = argv.includes("--prod")
  const execute = argv.includes("--execute")
  if (execute && !argv.includes("--confirm-time-travel")) {
    throw new Error("--execute requires --confirm-time-travel (D1 Time Travel is the rollback path)")
  }
  return {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    prod,
    env: prod ? "production" : undefined,
    only,
    manifest: resolve(get("--manifest") ?? `tmp/repair-booking-settlement-review-${prod ? "prod" : "staging"}.json`),
    execute,
    confirmTimeTravel: argv.includes("--confirm-time-travel"),
    allowNonMain: argv.includes("--allow-non-main"),
    cwd: dirname(resolve(wranglerConfig)),
  }
}

async function main(scriptPath: string): Promise<void> {
  const options = parseArgs(scriptPath)

  // Same provenance gate as the fleet runner: --execute refuses off-main or
  // dirty checkouts; read-only runs record but never block.
  const provenance = decideRolloutProvenance(
    probeRolloutProvenance(resolve(import.meta.dir, "../..")),
    { execute: options.execute, allowNonMain: options.allowNonMain },
  )
  if (!provenance.allow) throw new Error(provenance.reason)
  if (provenance.provenance.overrideUsed) {
    console.error(`\nWARNING: --allow-non-main break-glass override in effect: ${provenance.reason}\n`)
  } else {
    console.log(`provenance: ${provenance.reason}`)
  }

  const sql = await readFile(resolve(options.migrationsDir, MIGRATION), "utf8")
  const checksum = createHash("sha256").update(sql).digest("hex")
  const { columns, indexName } = parseSettlementReviewMigration(sql)

  // --only must name a database the shard config knows — never an arbitrary name.
  const map = await shardMap(options)
  if (![...map.values()].some((entry) => entry.name === options.only)) {
    throw new Error(
      `--only ${options.only} is not a database in ${options.wranglerConfig} (${options.prod ? "production" : "staging"} env). ` +
        "This repair targets exactly one config-known shard.",
    )
  }

  async function probe(): Promise<RepairProbe> {
    const rows = (
      await wranglerJson(options, options.only, ["--command", settlementReviewProbeSql(indexName)], "read")
    )[0].results[0] as Record<string, unknown>
    return probeFromRow(rows)
  }

  const before = await probe()
  const plan = planSettlementReviewRepair({ checksum, columns, indexName, probe: before })
  console.log(`target=${options.only}  fleet=${options.prod ? "PRODUCTION" : "staging"}  migration=${MIGRATION}  checksum=${checksum.slice(0, 12)}`)
  console.log(`probe: ${before.presentColumns.size}/${columns.length} columns present, index ${before.hasIndex ? "present" : "MISSING"}, ledger checksum ${before.ledgerChecksum ? before.ledgerChecksum.slice(0, 12) : "(no row)"}`)

  const record: Record<string, unknown> = {
    repair: "booking settlement review column convergence",
    migration: MIGRATION,
    checksum,
    database: options.only,
    fleet: options.prod ? "production" : "staging",
    executed: options.execute,
    rollout_provenance: provenance.provenance,
    probe_before: {
      present_columns: [...before.presentColumns].sort(),
      has_index: before.hasIndex,
      has_bookings: before.hasBookings,
      ledger_checksum: before.ledgerChecksum,
    },
    outcome: plan.kind,
  }

  async function finish(exitCode: number): Promise<never> {
    await mkdir(dirname(options.manifest), { recursive: true })
    await writeFile(options.manifest, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`manifest: ${options.manifest}`)
    process.exit(exitCode)
  }

  if (plan.kind === "refuse") {
    record.refusal_reason = plan.reason
    console.error(`\nREFUSED: ${plan.reason}`)
    await finish(1)
  }
  if (plan.kind === "converged") {
    console.log("\nALREADY CONVERGED: all nine columns and the index are present; nothing to do.")
    await finish(0)
  }

  console.log(`\nmissing columns: ${plan.missing.join(", ")}`)
  console.log("planned statements:")
  for (const statement of plan.statements) console.log(`  ${statement}`)
  record.plan = { missing_columns: plan.missing, statements: plan.statements }

  if (!options.execute) {
    console.log("\ndry run: no writes. Re-run with --execute --confirm-time-travel to converge.")
    await finish(0)
  }

  const file = `/tmp/1108-settlement-review-repair-${options.only}.sql`
  await writeFile(file, `${plan.statements.join("\n")}\n`)
  await wranglerJson(options, options.only, ["--file", file], "write")
  console.log(`\napplied ${plan.statements.length} statement(s); re-probing…`)

  const after = await probe()
  record.probe_after = {
    present_columns: [...after.presentColumns].sort(),
    has_index: after.hasIndex,
    ledger_checksum: after.ledgerChecksum,
  }
  const failures = convergenceFailures({ checksum, columns, indexName, probe: after })
  if (failures.length > 0) {
    record.verification = "FAILED"
    record.verification_failures = failures
    console.error(`\nPOST-REPAIR VERIFICATION FAILED:\n  ${failures.join("\n  ")}`)
    await finish(1)
  }
  record.verification = "converged"
  console.log(`\nCONVERGED: all ${columns.length} columns + ${indexName} present; ledger checksum unchanged.`)
  await finish(0)
}

if (import.meta.main) await main("scripts/community/repair-booking-settlement-review-columns-d1.ts")
