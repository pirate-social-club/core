#!/usr/bin/env bun
/** Repair staging shards whose recorded 1117 ledger predates its nullable posts column. */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"

const MIGRATION = "1117_async_post_publish.sql"
const COLUMN = "idempotency_body_hash"
const STATEMENT = "ALTER TABLE posts ADD COLUMN idempotency_body_hash TEXT;"

export type RepairProbe = { hasPosts: boolean; hasColumn: boolean; ledgerChecksum: string }
export type RepairPlan = { kind: "refuse" | "converged" | "repair"; reason?: string }

export function planRepair(input: { checksum: string; probe: RepairProbe }): RepairPlan {
  if (!input.probe.hasPosts) return { kind: "refuse", reason: "posts table is absent" }
  if (!input.probe.ledgerChecksum) return { kind: "refuse", reason: `no ledger row for ${MIGRATION}` }
  if (input.probe.ledgerChecksum !== input.checksum) return { kind: "refuse", reason: "1117 ledger checksum mismatch" }
  return input.probe.hasColumn ? { kind: "converged" } : { kind: "repair" }
}

if (import.meta.main) {
const argv = process.argv.slice(2)
const get = (flag: string) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1] }
const config = get("--wrangler-config")
const only = get("--only")?.split(",").map((x) => x.trim()).filter(Boolean) ?? []
if (!config || only.length === 0) throw new Error("--wrangler-config and --only DB_NAME[,DB_NAME...] are required")
const execute = argv.includes("--execute")
if (execute && !argv.includes("--confirm-time-travel")) throw new Error("--execute requires --confirm-time-travel")
const wranglerConfig = resolve(config)
const cwd = dirname(wranglerConfig)
const manifest = resolve(get("--manifest") ?? "tmp/staging-posts-idempotency-body-hash-repair.json")
const provenance = decideRolloutProvenance(probeRolloutProvenance(resolve(import.meta.dir, "../..")), { execute, allowNonMain: argv.includes("--allow-non-main") })
if (!provenance.allow) throw new Error(provenance.reason)
const sql = await readFile(resolve(get("--migrations-dir") ?? "db/community-template/migrations", MIGRATION), "utf8")
const checksum = createHash("sha256").update(sql).digest("hex")
const map = await shardMap({ wranglerConfig, prod: false })
const results: unknown[] = []
for (const database of only) {
  if (![...map.values()].some((entry) => entry.name === database)) throw new Error(`${database} is not in staging config`)
  const probe = async (): Promise<RepairProbe> => {
    const rows = await wranglerJson({ cwd, env: undefined }, database, ["--command", `SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='posts') AS has_posts, (SELECT COUNT(*) FROM pragma_table_info('posts') WHERE name='${COLUMN}') AS has_column, (SELECT COALESCE(GROUP_CONCAT(checksum), '') FROM schema_migrations WHERE migration_name='${MIGRATION}') AS ledger_checksum`])
    const row = rows[0].results[0] as Record<string, unknown>
    return { hasPosts: Number(row.has_posts ?? 0) === 1, hasColumn: Number(row.has_column ?? 0) === 1, ledgerChecksum: String(row.ledger_checksum ?? "") }
  }
  const before = await probe(); const plan = planRepair({ checksum, probe: before }); const record: Record<string, unknown> = { database, migration: MIGRATION, checksum, statement: STATEMENT, executed: execute, probe_before: before, outcome: plan.kind }
  if (plan.kind === "repair" && execute) {
    const file = `/tmp/repair-${database}.sql`; await writeFile(file, `${STATEMENT}\n`); await wranglerJson({ cwd, env: undefined }, database, ["--file", file]); record.probe_after = await probe()
    if (!(record.probe_after as RepairProbe).hasColumn) throw new Error(`${database}: post-repair verification failed`)
  }
  results.push(record)
  console.log(`${database} ${plan.kind}${execute && plan.kind === "repair" ? " -> applied" : ""}`)
}
await mkdir(dirname(manifest), { recursive: true }); await writeFile(manifest, `${JSON.stringify({ repair: "staging posts idempotency_body_hash", provenance: provenance.provenance, results }, null, 2)}\n`); console.log(`manifest: ${manifest}`)
}
