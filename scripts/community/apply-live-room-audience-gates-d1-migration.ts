/** Apply live-room audience gates across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1122_live_room_audience_gates.sql",
  label: "community-template",
  requiredTables: ["live_rooms"],
  creates: {
    kind: "columns",
    table: "live_rooms",
    columns: ["audience_gate_json"],
  },
  replayableDdl: false,
  description: "Nullable per-room audience gate configuration.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-live-room-audience-gates-d1-migration.ts",
  )
}
