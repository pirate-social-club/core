import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { BASELINE_ROWS, generateScaleFixture } from "./generate-generic-assets-scale-rehearsal"

let directory: string | undefined
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe("generic-assets scale rehearsal generator", () => {
  test("rejects an unreviewed scale factor", async () => {
    directory = await mkdtemp(join(tmpdir(), "generic-assets-scale-"))
    await expect(generateScaleFixture({
      database: join(directory, "fixture.sqlite"),
      migrationsDir: resolve(import.meta.dir, "../../db/community-template/migrations"),
      factor: 10,
      paddingBytes: 1,
    })).rejects.toThrow("exactly 100 or 1000")
  })

  test("pins the real-shard baseline used by both factors", () => {
    expect(BASELINE_ROWS).toEqual({
      posts: 29,
      assets: 28,
      post_publish_requests: 22,
      moderation_actions: 3,
    })
  })

  test("declares both reviewed scale factors", async () => {
    const source = await Bun.file(new URL("./generate-generic-assets-scale-rehearsal.ts", import.meta.url)).text()
    expect(source).toContain("factor !== 100 && input.factor !== 1000")
    expect(source).toContain("paddingBytes")
    expect(source).toContain("dumpD1CompatibleSql")
  })
})
