/** Apply the consolidated generic-assets and learning foundation fleet migration. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1158_generic_assets_learning_foundation.sql",
  label: "community-template",
  requiredTables: ["posts", "assets", "post_publish_requests", "moderation_actions"],
  // Keep this in lockstep with every source column in the four explicit
  // INSERT ... SELECT copies below. A ledger can claim an older migration
  // while a shard still lacks one of its columns, so checksum presence alone
  // is not sufficient preflight.
  requiredColumns: [
    ..."post_id community_id author_user_id identity_mode anonymous_scope anonymous_label disclosed_qualifiers_json label_id post_type status song_mode title body caption lyrics link_url media_refs_json song_artifact_bundle_id source_language translation_policy rights_basis asset_id parent_post_id analysis_state analysis_result_ref content_safety_state age_gate_policy created_at updated_at idempotency_key idempotency_body_hash publish_failure_code publish_failure_message publish_failure_retryable publish_failed_at flair_id access_mode upstream_asset_refs_json comment_count top_level_comment_count last_comment_at visibility authorship_mode agent_id agent_ownership_record_id agent_display_name_snapshot agent_owner_handle_snapshot agent_ownership_provider_snapshot label_assignment_status label_assigned_by label_assigned_at label_ai_confidence label_assignment_error label_assignment_model label_assignment_result_json agent_handle_snapshot link_og_image_url link_og_title embeds_json link_enrichment_snapshot_json link_enrichment_synced_at song_title song_cover_art_ref song_duration_ms crosspost_source_json song_annotations_url source_start_ms source_duration_ms sync_offset_ms source_language_confidence source_language_reliable source_language_detector source_language_detected_at source_language_source_hash song_instrumental_audio_json song_vocal_audio_json lyrics_language lyrics_language_confidence lyrics_language_reliable lyrics_language_detector lyrics_language_detected_at lyrics_language_source_hash age_gate_source age_gate_evidence_ref age_gate_set_at".split(" ").map((column) => ({ table: "posts", column })),
    ..."asset_id community_id source_post_id song_artifact_bundle_id creator_user_id asset_kind rights_basis access_mode primary_content_ref primary_content_hash preview_audio_json cover_art_json canvas_video_json publication_status story_status story_error story_ip_id story_publish_tx_ref story_asset_version_id story_cdr_vault_uuid story_namespace story_entitlement_token_id story_read_condition story_write_condition story_ip_nft_contract story_ip_nft_token_id story_publish_model story_license_terms_id story_license_template story_royalty_policy story_derivative_registered_at story_revenue_token story_cdr_encrypted_cid story_cdr_allocate_tx_ref story_cdr_write_tx_ref story_royalty_policy_id story_derivative_parent_ip_ids_json story_royalty_registration_status license_preset commercial_rev_share_pct locked_delivery_status locked_delivery_ref locked_delivery_error locked_delivery_payload_json locked_delivery_storage_ref locked_delivery_secret_json display_title created_at updated_at royalty_allocation_status royalty_allocation_fingerprint royalty_allocation_version royalty_allocation_effect_key royalty_allocation_tx_hash ip_royalty_vault royalty_vault_total_supply royalty_vault_decimals royalty_allocation_registered_at royalty_allocation_projection_synced story_ip_metadata_uri story_ip_metadata_hash story_nft_metadata_uri story_nft_metadata_hash".split(" ").map((column) => ({ table: "assets", column })),
    ..."post_publish_request_id community_id post_id publish_mode request_body_hash listing_draft_json publish_options_json status failure_code failure_message created_at updated_at".split(" ").map((column) => ({ table: "post_publish_requests", column })),
    ..."moderation_action_id moderation_case_id community_id post_id comment_id actor_user_id action_type note created_at previous_post_status next_post_status previous_age_gate_policy next_age_gate_policy previous_content_safety_state next_content_safety_state evidence_ref".split(" ").map((column) => ({ table: "moderation_actions", column })),
  ],
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
