#!/usr/bin/env bun
/** Converge one shard whose recorded 1122 migration is missing its nullable column. */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"

const MIGRATION = "1122_live_room_audience_gates.sql"
const COLUMN = "audience_gate_json"

export type AudienceGateProbe = {
  hasLiveRooms: boolean
  hasColumn: boolean
  ledgerChecksum: string
}

export type AudienceGateRepairPlan =
  | { kind: "refuse"; reason: string }
  | { kind: "converged" }
  | { kind: "repair"; statement: string }

export function parseAudienceGateMigration(sql: string): string {
  const statements = sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
  if (statements.length !== 1) {
    throw new Error(`${MIGRATION}: expected exactly one statement, found ${statements.length}`)
  }
  const statement = `${statements[0]};`
  if (!/^ALTER\s+TABLE\s+live_rooms\s+ADD\s+COLUMN\s+audience_gate_json\s+TEXT;$/iu.test(statement)) {
    throw new Error(`${MIGRATION}: statement shape changed; this repair requires review`)
  }
  return statement
}

export function planAudienceGateRepair(input: {
  checksum: string
  statement: string
  probe: AudienceGateProbe
}): AudienceGateRepairPlan {
  if (!input.probe.hasLiveRooms) {
    return { kind: "refuse", reason: "live_rooms table is absent; that is a different repair" }
  }
  if (!input.probe.ledgerChecksum) {
    return { kind: "refuse", reason: `no ledger row for ${MIGRATION}; use the normal migration runner` }
  }
  if (input.probe.ledgerChecksum !== input.checksum) {
    return {
      kind: "refuse",
      reason: `ledger checksum ${input.probe.ledgerChecksum.slice(0, 12)} does not match ${input.checksum.slice(0, 12)}`,
    }
  }
  return input.probe.hasColumn ? { kind: "converged" } : { kind: "repair", statement: input.statement }
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
Converge one shard whose recorded ${MIGRATION} is missing live_rooms.${COLUMN}.
Never drops or updates rows and never edits schema_migrations.

  bun ${scriptPath} \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc \\
    --only DB_NAME [--prod] [--execute --confirm-time-travel]

Dry-run is the default. Execution requires a clean origin/main-contained checkout.
`)
  process.exit(1)
}

function parseArgs(scriptPath: string): Options {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const wranglerConfig = get("--wrangler-config")
  const only = get("--only")
  if (!wranglerConfig || !only) usage(scriptPath)
  const execute = argv.includes("--execute")
  if (execute && !argv.includes("--confirm-time-travel")) {
    throw new Error("--execute requires --confirm-time-travel (D1 Time Travel is the rollback path)")
  }
  const prod = argv.includes("--prod")
  return {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    prod,
    env: prod ? "production" : undefined,
    only,
    manifest: resolve(get("--manifest") ?? `tmp/repair-live-room-audience-gate-${prod ? "prod" : "staging"}.json`),
    execute,
    confirmTimeTravel: argv.includes("--confirm-time-travel"),
    allowNonMain: argv.includes("--allow-non-main"),
    cwd: dirname(resolve(wranglerConfig)),
  }
}

function probeSql(): string {
  return `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='live_rooms') AS has_live_rooms,
  (SELECT COUNT(*) FROM pragma_table_info('live_rooms') WHERE name='${COLUMN}') AS has_column,
  (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${MIGRATION}') AS ledger_checksum`
}

function probeFromRow(row: Record<string, unknown>): AudienceGateProbe {
  return {
    hasLiveRooms: Number(row.has_live_rooms ?? 0) === 1,
    hasColumn: Number(row.has_column ?? 0) === 1,
    ledgerChecksum: String(row.ledger_checksum ?? ""),
  }
}

async function main(scriptPath: string): Promise<void> {
  const options = parseArgs(scriptPath)
  const provenance = decideRolloutProvenance(
    probeRolloutProvenance(resolve(import.meta.dir, "../..")),
    { execute: options.execute, allowNonMain: options.allowNonMain },
  )
  if (!provenance.allow) throw new Error(provenance.reason)
  if (provenance.provenance.overrideUsed) {
    console.error(`\nWARNING: --allow-non-main break-glass override: ${provenance.reason}\n`)
  } else {
    console.log(`provenance: ${provenance.reason}`)
  }

  const sql = await readFile(resolve(options.migrationsDir, MIGRATION), "utf8")
  const checksum = createHash("sha256").update(sql).digest("hex")
  const statement = parseAudienceGateMigration(sql)
  const map = await shardMap(options)
  if (![...map.values()].some((entry) => entry.name === options.only)) {
    throw new Error(`--only ${options.only} is not present in the selected shard configuration`)
  }

  const probe = async () => {
    const rows = await wranglerJson(options, options.only, ["--command", probeSql()])
    return probeFromRow(rows[0].results[0] as Record<string, unknown>)
  }
  const before = await probe()
  const plan = planAudienceGateRepair({ checksum, statement, probe: before })
  const record: Record<string, unknown> = {
    repair: "live room audience gate column convergence",
    migration: MIGRATION,
    checksum,
    database: options.only,
    fleet: options.prod ? "production" : "staging",
    executed: options.execute,
    rollout_provenance: provenance.provenance,
    probe_before: before,
    outcome: plan.kind,
  }
  const finish = async (exitCode: number): Promise<never> => {
    await mkdir(dirname(options.manifest), { recursive: true })
    await writeFile(options.manifest, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`manifest: ${options.manifest}`)
    process.exit(exitCode)
  }

  console.log(`target=${options.only} fleet=${options.prod ? "PRODUCTION" : "staging"} migration=${MIGRATION}`)
  if (plan.kind === "refuse") {
    record.refusal_reason = plan.reason
    console.error(`REFUSED: ${plan.reason}`)
    await finish(1)
  }
  if (plan.kind === "converged") {
    console.log(`ALREADY CONVERGED: live_rooms.${COLUMN} is present`)
    await finish(0)
  }

  record.plan = { statement: plan.statement }
  console.log(`planned statement: ${plan.statement}`)
  if (!options.execute) {
    console.log("dry run: no writes")
    await finish(0)
  }

  const file = `/tmp/1122-audience-gate-repair-${options.only}.sql`
  await writeFile(file, `${plan.statement}\n`)
  await wranglerJson(options, options.only, ["--file", file])
  const after = await probe()
  record.probe_after = after
  if (!after.hasLiveRooms || !after.hasColumn || after.ledgerChecksum !== checksum) {
    record.verification = "FAILED"
    console.error("POST-REPAIR VERIFICATION FAILED")
    await finish(1)
  }
  record.verification = "converged"
  console.log(`CONVERGED: live_rooms.${COLUMN} present; ledger checksum unchanged`)
  await finish(0)
}

if (import.meta.main) await main("scripts/community/repair-live-room-audience-gate-column-d1.ts")
