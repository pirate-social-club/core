import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0157_control_plane_efp_follow_read_model_invariants.sql",
  "utf8",
)

describe("EFP follow read-model invariants migration", () => {
  test("requires normalized addresses", () => {
    expect(migration).toContain("follower_address = lower(follower_address)")
    expect(migration).toContain("followed_address = lower(followed_address)")
    expect(migration).toContain("wallet_address = lower(wallet_address)")
  })

  test("makes all production storage chains explicit coverage requirements", () => {
    expect(migration).toContain("efp_follow_projection_expected_chains")
    expect(migration).toMatch(/\(1, 64, TRUE/)
    expect(migration).toMatch(/\(10, 64, TRUE/)
    expect(migration).toMatch(/\(8453, 64, TRUE/)
  })

  test("records reconciliation health and follows-only scope", () => {
    expect(migration).toContain("last_reconciled_at")
    expect(migration).toContain("last_reconciliation_error")
    expect(migration).toContain("intentionally follows-only")
  })
})
