#!/usr/bin/env bun

/** Additive repair for staging shards that predate source columns copied by 1158. */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"

export const REPAIRS = [
  { migration: "1143_lyrics_language.sql", columns: [
    ["posts", "lyrics_language", "TEXT"], ["posts", "lyrics_language_confidence", "REAL"],
    ["posts", "lyrics_language_reliable", "INTEGER NOT NULL DEFAULT 0"], ["posts", "lyrics_language_detector", "TEXT"],
    ["posts", "lyrics_language_detected_at", "TEXT"], ["posts", "lyrics_language_source_hash", "TEXT"],
  ] },
  { migration: "1148_post_age_gate_provenance.sql", columns: [
    ["posts", "age_gate_source", "TEXT CHECK (age_gate_source IS NULL OR age_gate_source IN ('author','community_default','post_moderation','bundle_moderation','moderator','legacy_unknown'))"],
    ["posts", "age_gate_evidence_ref", "TEXT"], ["posts", "age_gate_set_at", "TEXT"],
  ] },
  { migration: "1100_asset_royalty_allocation_projection_synced.sql", columns: [
    ["assets", "royalty_allocation_projection_synced", "INTEGER NOT NULL DEFAULT 1 CHECK (royalty_allocation_projection_synced IN (0, 1))"],
  ] },
] as const

type Column = { table: string; name: string }
type Probe = { columns: Column[]; ledgers: Record<string, string> }
export type RepairPlan = { kind: "repair" | "converged" | "refuse"; statements?: string[]; reason?: string }

export function planRepair(probe: Probe, checksums: Record<string, string>): RepairPlan {
  const present = new Set(probe.columns.map(({ table, name }) => `${table}.${name}`))
  const missingRepairs = REPAIRS.filter((repair) => repair.columns.some(([table, column]) => !present.has(`${table}.${column}`)))
  const missingLedger = missingRepairs.filter(({ migration }) => probe.ledgers[migration] !== checksums[migration])
  if (missingLedger.length > 0) return { kind: "refuse", reason: `missing or mismatched ledger: ${missingLedger.map(({ migration }) => migration).join(", ")}` }
  const statements: string[] = []
  for (const repair of REPAIRS) {
    if (probe.ledgers[repair.migration] !== checksums[repair.migration]) continue
    for (const [table, column, declaration] of repair.columns) {
      if (!present.has(`${table}.${column}`)) statements.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration};`)
    }
  }
  if (statements.length === 0) return { kind: "converged" }
  return { kind: "repair", statements }
}

async function main() {
  const argv = process.argv.slice(2)
  const get = (flag: string) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1] }
  const config = get("--wrangler-config"); if (!config) throw new Error("--wrangler-config is required")
  const execute = argv.includes("--execute")
  if (execute && !argv.includes("--confirm-time-travel")) throw new Error("--execute requires --confirm-time-travel")
  const wranglerConfig = resolve(config); const cwd = dirname(wranglerConfig)
  const provenance = decideRolloutProvenance(probeRolloutProvenance(resolve(import.meta.dir, "../..")), { execute, allowNonMain: argv.includes("--allow-non-main") })
  if (!provenance.allow) throw new Error(provenance.reason)
  const migrationDir = resolve(get("--migrations-dir") ?? "db/community-template/migrations")
  const checksums = Object.fromEntries(await Promise.all(REPAIRS.map(async ({ migration }) => [migration, createHash("sha256").update(await readFile(resolve(migrationDir, migration))).digest("hex")])))
  const map = await shardMap({ wranglerConfig, prod: false })
  const only = get("--only")?.split(",").map((x) => x.trim()).filter(Boolean)
  const targets = only?.length ? only : [...map.values()].map(({ name }) => name)
  const manifest = resolve(get("--manifest") ?? "tmp/staging-1158-source-column-repair.json")
  const results: unknown[] = []
  const probe = async (database: string): Promise<Probe> => {
    const command = `SELECT (SELECT COALESCE(json_group_array(json_object('table', 'posts', 'name', name)), '[]') FROM pragma_table_info('posts')) AS posts_columns, (SELECT COALESCE(json_group_array(json_object('table', 'assets', 'name', name)), '[]') FROM pragma_table_info('assets')) AS assets_columns, (SELECT COALESCE(GROUP_CONCAT(migration_name || '=' || checksum, '|'), '') FROM schema_migrations WHERE migration_name IN ('1143_lyrics_language.sql','1148_post_age_gate_provenance.sql','1100_asset_royalty_allocation_projection_synced.sql')) AS ledgers`
    const row = (await wranglerJson({ cwd, env: undefined }, database, ["--command", command]))[0].results[0] as Record<string, unknown>
    const columns = ["posts_columns", "assets_columns"].flatMap((key) => { try { return JSON.parse(String(row[key] ?? "[]")) as Column[] } catch { return [] } })
    const ledgers = Object.fromEntries(String(row.ledgers ?? "").split("|").filter(Boolean).map((entry) => { const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)] }))
    return { columns, ledgers }
  }
  for (const database of targets) {
    const before = await probe(database); const plan = planRepair(before, checksums); const record: Record<string, unknown> = { database, executed: execute, probe_before: before, outcome: plan.kind, statements: plan.statements ?? [], checksums }
    if (execute && plan.kind === "repair") {
      const file = `/tmp/repair-1158-source-columns-${database}.sql`; await writeFile(file, `${plan.statements!.join("\n")}\n`)
      await wranglerJson({ cwd, env: undefined }, database, ["--file", file]); const after = await probe(database); record.probe_after = after
      if (planRepair(after, checksums).kind !== "converged") throw new Error(`${database}: post-repair verification failed`)
    }
    results.push(record); console.log(`${database} ${plan.kind}${execute && plan.kind === "repair" ? " -> applied" : ""}`)
  }
  await mkdir(dirname(manifest), { recursive: true }); await writeFile(manifest, `${JSON.stringify({ repair: "1158 source columns", executed: execute, provenance: provenance.provenance, summary: results.reduce<Record<string, number>>((a, r) => { const k = String((r as { outcome: string }).outcome); a[k] = (a[k] ?? 0) + 1; return a }, {}), results }, null, 2)}\n`)
  if (results.some((r) => (r as { outcome: string }).outcome === "refuse")) process.exit(2)
}

if (import.meta.main) await main()
