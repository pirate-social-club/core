/** Apply the consolidated generic-assets and learning foundation fleet migration. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1158_generic_assets_learning_foundation.sql",
  label: "community-template",
  requiredTables: ["posts", "assets", "post_publish_requests", "moderation_actions"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "moderation_actions", column: "asset_id" },
      { table: "moderation_actions", column: "previous_asset_enforcement_state" },
      { table: "moderation_actions", column: "next_asset_enforcement_state" },
    ],
    tables: [
      "asset_payloads",
      "asset_enforcement",
      "learning_decks",
      "learning_deck_versions",
      "learning_cards",
      "learning_card_versions",
      "learning_review_items",
      "learning_review_events",
      "learning_review_state",
      "learning_sessions",
      "learning_session_items",
    ],
    indexes: [
      "idx_asset_payloads_active_primary",
      "idx_asset_enforcement_state_updated",
      "idx_moderation_actions_asset_created",
      "idx_learning_decks_community_status",
      "idx_learning_review_state_due",
      "idx_learning_sessions_user_status",
      "idx_learning_session_items_status",
    ],
    tableSqlContains: [
      { table: "posts", fragments: ["'file'", "'deck'", "'payload_safety_blocked'"] },
      {
        table: "assets",
        fragments: ["'download_file'", "'learning_deck'", "assets_primary_content_ref_kind_check"],
      },
      { table: "post_publish_requests", fragments: ["'payload_claim_failed'", "'deck_package_hash_mismatch'"] },
      {
        table: "moderation_actions",
        fragments: ["'quarantine_asset'", "moderation_actions_asset_transition_check"],
      },
    ],
    finalIndexes: [
      "idx_posts_community_created",
      "idx_posts_author_idempotency",
      "idx_assets_source_post",
      "idx_assets_story_asset_version_id",
      "idx_post_publish_requests_status",
      "idx_moderation_actions_case_created",
    ],
    forbiddenTables: [
      "posts_next",
      "assets_next",
      "post_publish_requests_next",
      "moderation_actions_next",
    ],
  },
  rowCountTables: ["posts", "assets", "post_publish_requests", "moderation_actions"],
  // Four hot tables are rebuilt. A partial result requires operator review and
  // must never be replayed automatically.
  replayableDdl: false,
  description: "Generic asset payloads, linked enforcement, and dormant learning schema.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-generic-assets-learning-foundation-d1-migration.ts",
  )
}
