import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type AuditManifest = {
  fleet: "production" | "staging"
  canonical_schema_checked: boolean
  shards: Array<{ binding: string; canonical_missing?: string[] }>
}

const argv = process.argv.slice(2)
const get = (flag: string) => {
  const index = argv.indexOf(flag)
  return index < 0 ? undefined : argv[index + 1]
}
const input = get("--manifest")
const output = get("--output")
if (!input || !output) {
  throw new Error("usage: bun scripts/community/build-canonical-schema-baseline.ts --manifest PATH --output PATH")
}

const manifest = JSON.parse(await readFile(resolve(input), "utf8")) as AuditManifest
if (!manifest.canonical_schema_checked) throw new Error(`${input}: canonical schema was not checked`)

const profileBySignature = new Map<string, string>()
const profiles: Record<string, string[]> = {}
const shards: Record<string, string> = {}
for (const shard of [...manifest.shards].sort((a, b) => a.binding.localeCompare(b.binding))) {
  const missing = [...new Set(shard.canonical_missing ?? [])].sort()
  if (missing.length === 0) continue
  const signature = JSON.stringify(missing)
  let profile = profileBySignature.get(signature)
  if (!profile) {
    profile = `missing_${String(profileBySignature.size + 1).padStart(2, "0")}`
    profileBySignature.set(signature, profile)
    profiles[profile] = missing
  }
  shards[shard.binding] = profile
}

await writeFile(resolve(output), `${JSON.stringify({ version: 1, fleet: manifest.fleet, profiles, shards }, null, 2)}\n`)
console.log(`wrote ${output}: ${Object.keys(profiles).length} profile(s), ${Object.keys(shards).length} shard exception(s)`)
