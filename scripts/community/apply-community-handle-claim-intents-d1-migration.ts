/**
 * Operator spec for applying community-template migration
 * 1157_community_handle_claim_intents.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1157_community_handle_claim_intents.sql",
  label: "community-template",
  requiredTables: [
    "community_handle_claim_quotes",
    "community_handle_label_reservations",
    "community_handles",
  ],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "community_handle_claim_quotes", column: "handle_claim_intent_id" },
      { table: "community_handle_label_reservations", column: "handle_claim_intent_id" },
      { table: "community_handles", column: "handle_claim_intent_id" },
    ],
    indexes: [
      "idx_community_handle_claim_quotes_intent",
      "idx_community_handle_label_reservations_active_intent",
      "idx_community_handles_claim_intent_once",
    ],
  },
  replayableDdl: false,
  description: "Idempotent shard-side claim-intent markers and uniqueness guards for handle recovery.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-community-handle-claim-intents-d1-migration.ts",
  )
}
