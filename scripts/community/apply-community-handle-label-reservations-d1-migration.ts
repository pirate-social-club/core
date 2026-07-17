/**
 * Operator spec for applying community-template migration
 * 1136_community_handle_label_reservations.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1136_community_handle_label_reservations.sql",
  label: "community-template",
  requiredTables: ["communities", "community_handle_claim_quotes", "community_handles", "namespace_bindings"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "community_handle_label_reservations", column: "handle_label_reservation_id" },
      { table: "community_handle_label_reservations", column: "community_id" },
      { table: "community_handle_label_reservations", column: "namespace_id" },
      { table: "community_handle_label_reservations", column: "label_normalized" },
      { table: "community_handle_label_reservations", column: "user_id" },
      { table: "community_handle_label_reservations", column: "handle_claim_quote_id" },
      { table: "community_handle_label_reservations", column: "purpose" },
      { table: "community_handle_label_reservations", column: "status" },
      { table: "community_handle_label_reservations", column: "reserved_at" },
      { table: "community_handle_label_reservations", column: "expires_at" },
      { table: "community_handle_label_reservations", column: "consumed_at" },
      { table: "community_handle_label_reservations", column: "released_at" },
      { table: "community_handle_label_reservations", column: "created_at" },
      { table: "community_handle_label_reservations", column: "updated_at" },
    ],
    indexes: [
      "idx_community_handle_label_reservations_active_label",
      "idx_community_handle_label_reservations_active_expiry",
    ],
  },
  replayableDdl: false,
  description: "Cross-path namespace label mutex for paid quotes, claims, and owner reservations.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-community-handle-label-reservations-d1-migration.ts",
  )
}
