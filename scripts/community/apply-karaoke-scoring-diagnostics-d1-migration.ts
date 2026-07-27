/** Apply durable karaoke scoring diagnostics across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1144_karaoke_scoring_diagnostics.sql",
  label: "community-template",
  requiredTables: ["karaoke_attempt"],
  creates: {
    kind: "schema_objects",
    columns: [{ table: "karaoke_attempt", column: "scoring_diagnostics_json" }],
    indexes: [],
  },
  replayableDdl: false,
  description: "Derived-only calibration and per-line karaoke scoring diagnostics.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-karaoke-scoring-diagnostics-d1-migration.ts",
  )
}
