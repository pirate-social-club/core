/** Select the largest allocated+loaded production community shard for rehearsal. */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { loadedBindings, shardMap } from "./lib/fleet-d1-migration"

export type D1Info = {
  uuid: string
  name: string
  database_size: number
  num_tables: number
}

export function parseD1InfoOutput(output: string): D1Info {
  for (let index = output.indexOf("{"); index !== -1; index = output.indexOf("{", index + 1)) {
    try {
      const parsed = JSON.parse(output.slice(index)) as Partial<D1Info>
      if (
        typeof parsed.uuid === "string" &&
        typeof parsed.name === "string" &&
        Number.isFinite(parsed.database_size) &&
        Number.isFinite(parsed.num_tables)
      ) {
        return parsed as D1Info
      }
    } catch {
      // Wrangler warnings can precede the JSON object. Keep scanning.
    }
  }
  throw new Error(`no D1 info JSON object found: ${output.slice(0, 300)}`)
}

export function selectLargestShard(
  rows: readonly { binding: string; info: D1Info }[],
): { binding: string; info: D1Info } {
  if (rows.length === 0) throw new Error("no allocated+loaded production shards were inspected")
  return [...rows].sort((left, right) =>
    right.info.database_size - left.info.database_size || left.binding.localeCompare(right.binding)
  )[0]!
}

async function d1Info(cwd: string, binding: string): Promise<D1Info> {
  const process = Bun.spawn(
    ["bunx", "wrangler", "d1", "info", binding, "--env", "production", "--json"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0) throw new Error(`wrangler d1 info failed for ${binding}: ${(stderr || stdout).slice(0, 500)}`)
  return parseD1InfoOutput(`${stderr}\n${stdout}`)
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next
      next += 1
      results[index] = await operation(values[index]!)
    }
  }))
  return results
}

async function main(): Promise<void> {
  const get = (name: string): string | undefined => {
    const index = Bun.argv.indexOf(name)
    return index === -1 ? undefined : Bun.argv[index + 1]
  }
  const wranglerConfig = resolve(get("--wrangler-config") ?? "../api/services/community-d1-shard/wrangler.jsonc")
  const cwd = dirname(wranglerConfig)
  const manifest = resolve(get("--manifest") ?? "tmp/generic-assets-largest-shard-selection.json")
  const concurrency = Number(get("--concurrency") ?? "4")
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 through 8")
  }

  const bindings = await loadedBindings({ env: "production", cwd, poolDb: "D1_POOL" })
  const configured = await shardMap({ wranglerConfig, prod: true })
  const missing = bindings.filter((binding) => !configured.has(binding))
  if (missing.length) throw new Error(`allocated+loaded bindings missing from production config: ${missing.join(", ")}`)
  const rows = await mapWithConcurrency(bindings, concurrency, async (binding) => ({
    binding,
    info: await d1Info(cwd, binding),
  }))
  const largest = selectLargestShard(rows)
  const output = {
    generated_at: new Date().toISOString(),
    selection_rule: "largest database_size among allocated+loaded production community shards",
    inspected_shards: rows.length,
    binding: largest.binding,
    database_name: largest.info.name,
    database_id: largest.info.uuid,
    database_size_bytes: largest.info.database_size,
    table_count: largest.info.num_tables,
  }
  await mkdir(dirname(manifest), { recursive: true })
  await writeFile(manifest, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ...output, database_id: "(recorded in restricted manifest)" }, null, 2))
}

if (import.meta.main) await main()
