/**
 * Operator spec for applying community-template migration
 * 1122_live_room_audience_gates.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1122_live_room_audience_gates.sql",
  label: "community-template",
  requiredTables: ["live_rooms"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "live_rooms", column: "audience_gate_json" },
    ],
    indexes: [],
  },
  replayableDdl: false,
  description: "Persist the audience-gate policy attached to a live room.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-live-room-audience-gates-d1-migration.ts",
  )
}
