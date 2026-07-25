import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0158_control_plane_efp_follow_current_coverage.sql",
  "utf8",
)

describe("EFP current-chain coverage migration", () => {
  test("rejects current when a required cursor, watermark, or safe head is missing", () => {
    expect(migration).toContain("expected.enabled")
    expect(migration).toContain("cursor.chain_id IS NULL")
    expect(migration).toContain("watermark.chain_id IS NULL")
    expect(migration).toContain("watermark.applied_through_block < cursor.safe_head_block")
  })

  test("checks coverage at transaction commit", () => {
    expect(migration).toContain("CREATE CONSTRAINT TRIGGER")
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED")
  })
})
