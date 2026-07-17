/** Apply community-template migration 1137 across the allocated+loaded D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1137_community_handle_payment_reservation_cap.sql",
  label: "community-template",
  requiredTables: ["community_handle_label_reservations"],
  creates: {
    kind: "schema_objects",
    columns: [],
    indexes: ["idx_community_handle_label_reservations_active_payment_user"],
  },
  replayableDdl: false,
  description: "One active paid handle-label reservation per user and community shard.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-community-handle-payment-reservation-cap-d1-migration.ts",
  )
}
