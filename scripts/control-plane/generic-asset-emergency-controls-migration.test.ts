import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0231_control_plane_generic_asset_emergency_controls.sql",
  "utf8",
)

describe("generic asset emergency controls migration", () => {
  test("supports global and scoped fail-closed controls without deletion", () => {
    expect(migration).toContain("CREATE TABLE generic_asset_emergency_controls")
    expect(migration).toContain("'content_hash'")
    expect(migration).toContain("'validation_profile'")
    expect(migration).toContain("state IN ('active', 'cleared')")
    expect(migration).toContain("cleared_at")
    expect(migration).toContain("idx_generic_asset_emergency_controls_active")
  })
})

