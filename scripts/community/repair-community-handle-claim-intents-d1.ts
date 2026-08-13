#!/usr/bin/env bun

/**
 * Audit and converge partial 1157 states without replaying existing ALTERs.
 *
 * This is intentionally separate from the generic migration runner: SQLite
 * has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS, and a failed 1157 upload
 * can leave a subset of the three columns present before the index statements.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  ledgerStatement,
  loadedBindings,
  resumeDoneShards,
  resumeEntryKey,
  shardMap,
  wranglerJson,
  type MigrationSpec,
  type Options,
} from "./lib/fleet-d1-migration"
import { partitionQuarantinedBindings } from "./lib/community-shard-quarantine"
import { decideFleetProvenance, probeConfigRepoProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"
import { SPEC } from "./apply-community-handle-claim-intents-d1-migration"

const MIGRATION = "1157_community_handle_claim_intents.sql"
const COLUMNS = [
  { table: "community_handle_claim_quotes", column: "handle_claim_intent_id" },
  { table: "community_handle_label_reservations", column: "handle_claim_intent_id" },
  { table: "community_handles", column: "handle_claim_intent_id" },
] as const
const INDEXES = [
  "idx_community_handle_claim_quotes_intent",
  "idx_community_handle_label_reservations_active_intent",
  "idx_community_handles_claim_intent_once",
] as const

type Probe = {
  hasLedger: boolean
  ledgerChecksum: string
  requiredTables: Record<string, boolean>
  columns: Record<string, boolean>
  indexes: Record<string, boolean>
}

export type RepairPlan =
  | { kind: "refuse"; reason: string }
  | { kind: "converged" }
  | { kind: "skip"; reason: string }
  | { kind: "repair"; statements: string[]; ledger: boolean }

function q(value: string): string {
  return value.replaceAll("'", "''")
}

export function probeSql(spec: MigrationSpec = SPEC): string {
  const required = spec.requiredTables.map(
    (table) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${q(table)}') AS req_${table}`,
  )
  const columns = COLUMNS.map(
    ({ table, column }) =>
      `(SELECT COUNT(*) FROM pragma_table_info('${q(table)}') WHERE name='${q(column)}') AS col_${table}__${column}`,
  )
  const indexes = INDEXES.map(
    (index) =>
      `(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${q(index)}') AS idx_${index}`,
  )
  return `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations') AS has_ledger,
  (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${MIGRATION}') AS ledger_checksum,
  ${[...required, ...columns, ...indexes].join(",\n  ")}`
}

function flag(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

export function probeFromRow(row: Record<string, unknown>): Probe {
  return {
    hasLedger: flag(row.has_ledger),
    ledgerChecksum: String(row.ledger_checksum ?? ""),
    requiredTables: Object.fromEntries(SPEC.requiredTables.map((table) => [table, flag(row[`req_${table}`])])),
    columns: Object.fromEntries(COLUMNS.map(({ table, column }) => [`${table}.${column}`, flag(row[`col_${table}__${column}`])])),
    indexes: Object.fromEntries(INDEXES.map((index) => [index, flag(row[`idx_${index}`])])),
  }
}

function allObjectsPresent(probe: Probe): boolean {
  return [...Object.values(probe.columns), ...Object.values(probe.indexes)].every(Boolean)
}

function statementFor(statements: readonly string[], pattern: RegExp, label: string): string {
  const matches = statements.filter((statement) => pattern.test(statement))
  if (matches.length !== 1) throw new Error(`${MIGRATION}: expected exactly one ${label} statement, found ${matches.length}`)
  return matches[0]
}

/** Parse only the reviewed six statement shapes from the canonical migration. */
export function parseMigrationStatements(sql: string): {
  columns: Record<string, string>
  indexes: Record<string, string>
} {
  const statements = sql
    .replace(/--[^\n]*(?:\n|$)/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part};`)
  const columns: Record<string, string> = {}
  for (const { table, column } of COLUMNS) {
    columns[`${table}.${column}`] = statementFor(
      statements,
      new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+${column}\\s+TEXT\\s*;`, "iu"),
      `ALTER for ${table}.${column}`,
    )
  }
  const indexes: Record<string, string> = {}
  for (const index of INDEXES) {
    indexes[index] = statementFor(
      statements,
      new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${index}\\s+ON\\s+`, "iu"),
      `CREATE for ${index}`,
    )
  }
  if (statements.length !== COLUMNS.length + INDEXES.length) {
    throw new Error(`${MIGRATION}: expected exactly six statements, found ${statements.length}`)
  }
  return { columns, indexes }
}

export function planRepair(probe: Probe, checksum: string, statements: ReturnType<typeof parseMigrationStatements>): RepairPlan {
  const missingRequired = Object.entries(probe.requiredTables).filter(([, present]) => !present).map(([table]) => table)
  if (!probe.hasLedger || missingRequired.length > 0) {
    if (missingRequired.length > 0) return { kind: "refuse", reason: `required table(s) missing: ${missingRequired.join(", ")}` }
    return { kind: "refuse", reason: `schema_migrations is absent; use the normal migration runner` }
  }
  if (probe.ledgerChecksum && probe.ledgerChecksum !== checksum) {
    return { kind: "refuse", reason: `ledger checksum ${probe.ledgerChecksum.slice(0, 12)} does not match ${checksum.slice(0, 12)}` }
  }
  const missingColumns = COLUMNS
    .map(({ table, column }) => `${table}.${column}`)
    .filter((key) => !probe.columns[key])
  const missingIndexes = INDEXES.filter((index) => !probe.indexes[index])
  if (missingColumns.length === 0 && missingIndexes.length === 0) {
    return probe.ledgerChecksum === checksum ? { kind: "converged" } : { kind: "repair", statements: [], ledger: true }
  }
  if (missingColumns.length === COLUMNS.length && missingIndexes.length === INDEXES.length && !probe.ledgerChecksum) {
    return { kind: "refuse", reason: `no objects are present; use the normal migration runner` }
  }
  const repairStatements = [
    ...missingColumns.map((key) => statements.columns[key]),
    ...missingIndexes.map((index) => statements.indexes[index]),
  ]
  return { kind: "repair", statements: repairStatements, ledger: !probe.ledgerChecksum }
}

type RepairOptions = Pick<Options, "wranglerConfig" | "migrationsDir" | "env" | "poolDb" | "quarantineRegistry" | "prod" | "execute" | "confirmTimeTravel" | "allowNonMain" | "manifest" | "resumeFile" | "only" | "concurrency" | "cwd"> & {
  partialOnly: boolean
}

function parseArgs(scriptPath: string): RepairOptions {
  const argv = process.argv.slice(2)
  const get = (flagName: string) => {
    const index = argv.indexOf(flagName)
    return index === -1 ? undefined : argv[index + 1]
  }
  const wranglerConfig = get("--wrangler-config")
  if (!wranglerConfig) throw new Error(`usage: bun ${scriptPath} --wrangler-config PATH [--execute --confirm-time-travel]`)
  const prod = argv.includes("--prod")
  const options: RepairOptions = {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    env: prod ? "production" : undefined,
    poolDb: prod ? "community-d1-shard-pool-prod" : "community-d1-shard-pool-staging",
    quarantineRegistry: resolve(get("--quarantines") ?? resolve(import.meta.dir, "../community-shard-quarantines.json")),
    prod,
    execute: argv.includes("--execute"),
    confirmTimeTravel: argv.includes("--confirm-time-travel"),
    allowNonMain: argv.includes("--allow-non-main"),
    manifest: resolve(get("--manifest") ?? `tmp/community-1157-repair-${prod ? "prod" : "staging"}.json`),
    resumeFile: get("--resume-file") ? resolve(get("--resume-file")!) : undefined,
    only: get("--only"),
    concurrency: Number(get("--concurrency") ?? "2"),
    cwd: dirname(resolve(wranglerConfig)),
    partialOnly: argv.includes("--partial-only"),
  }
  if (options.execute && !options.confirmTimeTravel) throw new Error("--execute requires --confirm-time-travel")
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be positive")
  return options
}

async function main(scriptPath: string): Promise<void> {
  const options = parseArgs(scriptPath)
  const provenance = decideFleetProvenance({
    core: probeRolloutProvenance(resolve(import.meta.dir, "../../..")),
    config: probeConfigRepoProvenance(options.wranglerConfig),
    execute: options.execute,
    allowNonMain: options.allowNonMain,
  })
  if (!provenance.allow) throw new Error(provenance.reason)
  console.log(`provenance: ${provenance.reason}`)

  const sql = await readFile(resolve(options.migrationsDir, MIGRATION), "utf8")
  const checksum = createHash("sha256").update(sql).digest("hex")
  const statements = parseMigrationStatements(sql)
  const map = await shardMap(options)
  const allocated = await loadedBindings(options)
  const partition = await partitionQuarantinedBindings(options.quarantineRegistry, options.prod ? "production" : "staging", allocated, new Set(map.keys()))
  const bindings = partition.live.filter((binding) => !options.only || map.get(binding)?.name === options.only)
  if (options.only && bindings.length !== 1) throw new Error(`--only ${options.only} did not match exactly one live shard`)
  const targets = bindings.map((binding) => ({ binding, ...(map.get(binding) ?? { name: "", id: "" }) })).filter((target) => target.name)
  if (targets.length !== bindings.length) throw new Error("allocated shard missing from clean shard config")

  const done = options.resumeFile ? resumeDoneShards(await readFile(options.resumeFile, "utf8").catch(() => ""), MIGRATION) : new Set<string>()
  const results: Array<Record<string, unknown>> = []
  let index = 0
  async function worker(): Promise<void> {
    while (index < targets.length) {
      const target = targets[index++]
      if (done.has(target.name)) continue
      try {
        const before = probeFromRow((await wranglerJson(options, target.name, ["--command", probeSql()]))[0].results[0] as Record<string, unknown>)
        let plan = planRepair(before, checksum, statements)
        if (options.partialOnly && plan.kind === "refuse" && plan.reason === "no objects are present; use the normal migration runner") {
          plan = { kind: "skip", reason: "pristine shard is owned by the normal migration runner" }
        }
        const record: Record<string, unknown> = { binding: target.binding, database_name: target.name, status: plan.kind, probe_before: before }
        if (options.execute && plan.kind === "repair") {
          const body = [...plan.statements, ...(plan.ledger ? [ledgerStatement(SPEC, checksum)] : [])].join("\n") + "\n"
          const file = `/tmp/community-1157-repair-${target.name}.sql`
          await writeFile(file, body)
          await wranglerJson(options, target.name, ["--file", file])
          const after = probeFromRow((await wranglerJson(options, target.name, ["--command", probeSql()]))[0].results[0] as Record<string, unknown>)
          const verified = planRepair(after, checksum, statements).kind === "converged"
          record.probe_after = after
          record.verification = verified ? "converged" : "failed"
          if (!verified) throw new Error(`post-repair verification failed for ${target.name}`)
          if (options.resumeFile) await writeFile(options.resumeFile, `${resumeEntryKey(MIGRATION, target.name)}\n`, { flag: "a" })
        }
        results.push(record)
        console.log(`  ${target.name.padEnd(34)} ${plan.kind}${options.execute && plan.kind === "repair" ? " -> converged" : ""}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        results.push({ binding: target.binding, database_name: target.name, status: "error", detail })
        console.error(`  ${target.name.padEnd(34)} error: ${detail}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(targets.length, 1)) }, worker))
  const summary = results.reduce<Record<string, number>>((counts, result) => {
    const status = String(result.status)
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
  await mkdir(dirname(options.manifest), { recursive: true })
  await writeFile(options.manifest, `${JSON.stringify({ fleet: options.prod ? "production" : "staging", migration: MIGRATION, checksum, executed: options.execute, partial_only: options.partialOnly, summary, shards: results }, null, 2)}\n`)
  console.log(`manifest: ${options.manifest}`)
  if (results.some((result) => result.status === "refuse" || result.verification === "failed")) process.exit(2)
}

if (import.meta.main) await main("scripts/community/repair-community-handle-claim-intents-d1.ts")
