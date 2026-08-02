import { describe, expect, test } from "bun:test"

import { SPEC as MODERATION } from "./apply-moderation-content-rating-audit-d1-migration"
import { SPEC as STREAKS } from "./apply-song-streak-owner-timezone-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("streak and moderation fleet migrations", () => {
  test("targets the two non-replayable migrations in order", () => {
    expect([STREAKS.migration, MODERATION.migration]).toEqual([
      "1149_song_streak_owner_timezone.sql",
      "1150_moderation_content_rating_audit.sql",
    ])
    expect(STREAKS.requiredTables).toEqual(["song_streaks"])
    expect(MODERATION.requiredTables).toEqual(["moderation_actions"])
    expect(STREAKS.replayableDdl).toBe(false)
    expect(MODERATION.replayableDdl).toBe(false)
  })

  test("attests every owner-timezone streak object", () => {
    const sql = classificationSql(STREAKS)

    expect(sql).toContain("song_streaks__timezone")
    expect(sql).toContain("song_streaks__timezone_updated_at")
    expect(sql).toContain("song_streaks__active_until_at")
    expect(sql).toContain("idx_song_streaks_active")
  })

  test("attests the rebuilt moderation action contract", () => {
    const sql = classificationSql(MODERATION)

    expect(sql).toContain("set_content_rating")
    expect(sql).toContain("previous_content_safety_state")
    expect(sql).toContain("next_content_safety_state")
    expect(sql).toContain("evidence_ref")
  })
})
