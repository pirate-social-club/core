import { describe, expect, test } from "bun:test"

import { convergenceFailures, plan, probeSql } from "./repair-staging-quarantined-schema-profiles-d1"

function probe(profile: "bookings_and_dance" | "replay_and_streaks", present: boolean) {
  const row: Record<string, number> = { required__communities: 1, required__live_rooms: 1 }
  const sql = probeSql(profile)
  for (const match of sql.matchAll(/ AS (table|column|index)__([A-Za-z0-9_]+)/g)) row[`${match[1]}__${match[2]}`] = present ? 1 : 0
  if (profile === "replay_and_streaks") {
    row.column__live_rooms__recording_enabled = 1
    row.column__live_rooms__replay_asset_id = 1
    row.column__live_rooms__replay_listing_id = 1
  }
  return row
}

describe("staging quarantine profile repair plan", () => {
  test("accepts the exact absent bookings/dance pre-image", () => {
    expect(plan("bookings_and_dance", probe("bookings_and_dance", false))).toBe("repair")
  })

  test("accepts replay/streak pre-images with all replay columns present or absent", () => {
    const row = probe("replay_and_streaks", false)
    expect(plan("replay_and_streaks", row)).toBe("repair")
    row.column__live_rooms__recording_enabled = 0
    row.column__live_rooms__replay_asset_id = 0
    row.column__live_rooms__replay_listing_id = 0
    expect(plan("replay_and_streaks", row)).toBe("repair")
  })

  test("refuses a mixed live-room replay-column state", () => {
    const row = probe("replay_and_streaks", false)
    row.column__live_rooms__replay_asset_id = 0
    expect(() => plan("replay_and_streaks", row)).toThrow("partial live_rooms")
  })

  test("refuses an unreviewed partial table state", () => {
    const row = probe("bookings_and_dance", false)
    row.table__bookings = 1
    expect(() => plan("bookings_and_dance", row)).toThrow("unreviewed partial table state")
  })

  test("recognizes a fully converged profile", () => {
    const row = probe("replay_and_streaks", true)
    expect(convergenceFailures("replay_and_streaks", row)).toEqual([])
    expect(plan("replay_and_streaks", row)).toBe("converged")
  })

  test("refuses present tables with a missing canonical index", () => {
    const row = probe("bookings_and_dance", true)
    row.index__idx_bookings_active_slot = 0
    expect(() => plan("bookings_and_dance", row)).toThrow("missing index idx_bookings_active_slot")
  })
})
