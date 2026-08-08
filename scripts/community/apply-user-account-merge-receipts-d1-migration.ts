/** Apply resumable user-account merge receipts across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1152_user_account_merge_receipts.sql",
  label: "community-template",
  requiredTables: [
    "community_memberships",
    "posts",
    "purchases",
    "bookings",
    "song_study_attempt",
    "song_study_review_state",
    "song_study_session",
    "song_engagement_days",
    "song_streaks",
    "reward_qualification_outbox",
  ],
  creates: {
    kind: "schema_objects",
    tables: ["user_account_merge_receipts"],
    indexes: ["idx_user_account_merge_receipts_canonical"],
  },
  replayableDdl: false,
  description: "Idempotency receipts for scoped Telegram account consolidation.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-user-account-merge-receipts-d1-migration.ts",
  )
}
