import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { artifactCount, expectedArtifacts } from "./community-schema-artifacts"

const MIGRATIONS = resolve(import.meta.dir, "../../db/community-template/migrations")
const readMigration = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8")

describe("expectedArtifacts — synthetic", () => {
  test("CREATE INDEX is derived (the gap that let 1124/1126 pass partially)", () => {
    const a = expectedArtifacts("CREATE INDEX idx_foo ON foo(bar);")
    expect(a.indexes).toEqual(["idx_foo"])
    expect(a.unrecognized).toEqual([])
  })

  test("CREATE UNIQUE INDEX IF NOT EXISTS is derived", () => {
    const a = expectedArtifacts("CREATE UNIQUE INDEX IF NOT EXISTS idx_u ON t(c);")
    expect(a.indexes).toEqual(["idx_u"])
  })

  test("unrecognized DDL is recorded, not silently dropped", () => {
    const a = expectedArtifacts("CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT 1; END;")
    // A trigger creates nothing this gate can COUNT, and mis-splitting on ';'
    // leaves fragments — all of which must land in `unrecognized`, never recognized.
    expect(a.tables).toEqual([])
    expect(a.columns).toEqual([])
    expect(a.indexes).toEqual([])
    expect(a.unrecognized.length).toBeGreaterThan(0)
  })

  test("DROP / data statements are unrecognized", () => {
    const a = expectedArtifacts("DROP TABLE old;\nUPDATE t SET x = 1;")
    expect(artifactCount(a)).toBe(0)
    expect(a.unrecognized).toContain("DROP TABLE old")
    expect(a.unrecognized).toContain("UPDATE t SET")
  })

  test("commented-out DDL never becomes an artifact", () => {
    const a = expectedArtifacts("-- CREATE INDEX idx_ghost ON t(c);\nCREATE INDEX idx_real ON t(c);")
    expect(a.indexes).toEqual(["idx_real"])
  })
})

// The load-bearing tests: assert the EXACT artifacts derived from the real files
// the gate ships against. A silent parser regression here is a silent gate hole.
describe("expectedArtifacts — real migration files", () => {
  test("1124_community_job_checkpoints: 4 columns + 1 table + 4 indexes, nothing unrecognized", () => {
    const a = expectedArtifacts(readMigration("1124_community_job_checkpoints.sql"))
    expect(a.columns).toEqual([
      ["community_jobs", "last_checkpoint"],
      ["community_jobs", "last_checkpoint_at"],
      ["community_jobs", "attempt_started_at"],
      ["community_jobs", "attempt_deadline_at"],
    ])
    expect(a.tables).toEqual(["community_job_events"])
    expect(a.indexes).toEqual([
      "idx_community_jobs_running_deadline",
      "idx_community_jobs_running_checkpoint",
      "idx_community_job_events_job",
      "idx_community_job_events_community",
    ])
    expect(a.altered).toEqual(["community_jobs"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(9) // 4 + 1 + 4
  })

  test("1126_reward_qualification_outbox: 1 table + 1 index (the index was previously unchecked)", () => {
    const a = expectedArtifacts(readMigration("1126_reward_qualification_outbox.sql"))
    expect(a.tables).toEqual(["reward_qualification_outbox"])
    expect(a.indexes).toEqual(["idx_reward_qualification_outbox_sequence"])
    expect(a.columns).toEqual([])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(2)
  })

  test("1127_asset_story_metadata_refs: 4 columns, nothing else", () => {
    const a = expectedArtifacts(readMigration("1127_asset_story_metadata_refs.sql"))
    expect(a.columns).toEqual([
      ["assets", "story_ip_metadata_uri"],
      ["assets", "story_ip_metadata_hash"],
      ["assets", "story_nft_metadata_uri"],
      ["assets", "story_nft_metadata_hash"],
    ])
    expect(a.tables).toEqual([])
    expect(a.indexes).toEqual([])
    expect(a.altered).toEqual(["assets"])
    expect(a.unrecognized).toEqual([])
    expect(artifactCount(a)).toBe(4)
  })
})
