import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { partitionQuarantinedBindings } from "./community-shard-quarantine"

let dir: string | undefined
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined })

async function registry(production: unknown[]) {
  dir = await mkdtemp(join(tmpdir(), "shard-quarantine-"))
  const path = join(dir, "registry.json")
  await writeFile(path, JSON.stringify({ version: 1, production, staging: [] }))
  return path
}

const entry = {
  binding: "DB_CMTY_0099",
  reason_code: "provider_storage_incident",
  approved_at: "2026-07-16T00:00:00Z",
  review_after: "2026-07-17T00:00:00Z",
  expires_at: "2026-07-18T00:00:00Z",
}

describe("community shard quarantine policy", () => {
  test("partitions an explicitly quarantined shard", async () => {
    const result = await partitionQuarantinedBindings(
      await registry([entry]), "production", ["DB_CMTY_0001", entry.binding],
      new Set(["DB_CMTY_0001", entry.binding]), Date.parse("2026-07-16T12:00:00Z"),
    )
    expect(result.live).toEqual(["DB_CMTY_0001"])
    expect(result.quarantined).toEqual([entry])
    expect(result.registryChecksum).toHaveLength(64)
  })

  test("fails closed for an expired quarantine", async () => {
    await expect(partitionQuarantinedBindings(
      await registry([entry]), "production", [entry.binding], new Set([entry.binding]),
      Date.parse(entry.expires_at),
    )).rejects.toThrow("expired")
  })

  test("fails closed for unknown and duplicate bindings", async () => {
    await expect(partitionQuarantinedBindings(
      await registry([entry]), "production", [], new Set([entry.binding]), 0,
    )).rejects.toThrow("not allocated+loaded")
    await expect(partitionQuarantinedBindings(
      await registry([entry, entry]), "production", [entry.binding], new Set([entry.binding]), 0,
    )).rejects.toThrow("duplicate")
  })
})
