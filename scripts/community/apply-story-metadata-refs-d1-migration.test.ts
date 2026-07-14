import { describe, expect, test } from "bun:test"

import { extractWranglerJson } from "./apply-story-metadata-refs-d1-migration"

const ESC = ""

describe("extractWranglerJson", () => {
  test("parses a clean JSON array (the --command path)", () => {
    const payload = [{ results: [{ has_assets: 1 }], success: true }]
    expect(extractWranglerJson(JSON.stringify(payload))).toEqual(payload)
  })

  // This is the exact shape that broke the first fleet run: wrangler prints
  // upload progress to STDOUT before the JSON, so JSON.parse(stdout) throws — and
  // the migration had ALREADY applied, leaving the tool's records wrong.
  test("parses through --file upload progress text", () => {
    const out = [
      "├ Checking if file needs uploading",
      "│",
      "├ 🌀 Uploading dc5a5279-43b4-4029-a65d-89b24db0f182.db077087f0e5177d.sql",
      "│ 🌀 Uploading complete.",
      "│",
      JSON.stringify([{ results: [{ "Total queries executed": 5 }], success: true }]),
    ].join("\n")
    const parsed = extractWranglerJson(out) as any[]
    expect(parsed[0].success).toBe(true)
    expect(parsed[0].results[0]["Total queries executed"]).toBe(5)
  })

  test("parses through ANSI colour and cursor escape sequences", () => {
    const out =
      `${ESC}[36m├ Checking if file needs uploading${ESC}[0m\n` +
      `${ESC}[1A${ESC}[2K${ESC}[32m│ Uploading complete.${ESC}[39m\n` +
      JSON.stringify([{ results: [{ ok: 1 }], success: true }])
    expect(extractWranglerJson(out)).toEqual([{ results: [{ ok: 1 }], success: true }])
  })

  // Scanning backwards from the last "[" would find the bracket opening
  // "results": [...] and parse it successfully — but as the WRONG value. Forward
  // scanning returns the true top-level payload.
  test("returns the TOP-LEVEL array, not a nested one", () => {
    const out = "├ progress\n" + JSON.stringify([{ results: [{ a: 1 }, { b: 2 }], success: true }])
    const parsed = extractWranglerJson(out) as any[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].results).toHaveLength(2)
    expect(parsed[0].success).toBe(true)
  })

  test("ignores a stray bracket inside progress text", () => {
    const out = "├ [warning] retrying upload [attempt 2]\n" + JSON.stringify([{ results: [], success: true }])
    expect(extractWranglerJson(out)).toEqual([{ results: [], success: true }])
  })

  test("throws when there is no JSON payload at all", () => {
    expect(() => extractWranglerJson("├ Uploading...\n│ failed\n")).toThrow(/no JSON array payload/)
  })

  test("throws rather than silently returning an object payload", () => {
    expect(() => extractWranglerJson(JSON.stringify({ error: "nope" }))).toThrow(/no JSON array payload/)
  })
})
