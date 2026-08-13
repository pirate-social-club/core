import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-generic-assets-learning-foundation-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("generic assets and learning foundation fleet migration", () => {
  test("classifies rebuilt contracts, new tables, retained indexes, and partial rebuilds", () => {
    expect(SPEC.migration).toBe("1158_generic_assets_learning_foundation.sql")
    expect(SPEC.requiredTables).toEqual([
      "posts",
      "assets",
      "post_publish_requests",
      "moderation_actions",
    ])
    expect(SPEC.rowCountTables).toEqual(SPEC.requiredTables)
    expect(SPEC.replayableDdl).toBe(false)

    const sql = classificationSql(SPEC)
    for (const marker of [
      "asset_payloads",
      "asset_enforcement",
      "learning_review_state",
      "learning_session_items",
      "asset_id",
      "idx_asset_payloads_active_primary",
      "idx_posts_author_idempotency",
      "download_file",
      "payload_claim_failed",
      "moderation_actions_asset_transition_check",
    ]) {
      expect(sql).toContain(marker)
    }
    for (const intermediate of [
      "posts_next",
      "assets_next",
      "post_publish_requests_next",
      "moderation_actions_next",
    ]) {
      expect(sql).toContain(intermediate)
    }
  })
})
