import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0230_control_plane_generic_asset_quota_reservations.sql",
  "utf8",
)

describe("generic asset quota reservation migration", () => {
  test("records physical-byte reservations with idempotent scope keys", () => {
    expect(migration).toContain("CREATE TABLE generic_asset_quota_reservations")
    expect(migration).toContain("reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0)")
    expect(migration).toContain("actual_bytes BIGINT CHECK (actual_bytes IS NULL OR actual_bytes >= 0)")
    expect(migration).toContain("UNIQUE (user_id, reservation_key)")
    expect(migration).toContain("status IN ('reserved', 'reconciled', 'released', 'failed')")
    expect(migration).toContain("status <> 'reconciled' OR actual_bytes IS NOT NULL")
  })
})
