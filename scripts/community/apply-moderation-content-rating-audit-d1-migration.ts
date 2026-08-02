/** Apply audited moderation content-rating transitions across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1150_moderation_content_rating_audit.sql",
  label: "community-template",
  requiredTables: ["moderation_actions"],
  creates: {
    kind: "table_sql_contains",
    table: "moderation_actions",
    fragments: [
      "set_content_rating",
      "previous_content_safety_state",
      "next_content_safety_state",
      "evidence_ref",
    ],
  },
  replayableDdl: false,
  description: "Evidence-backed moderation content-rating and age-gate transitions.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-moderation-content-rating-audit-d1-migration.ts",
  )
}
