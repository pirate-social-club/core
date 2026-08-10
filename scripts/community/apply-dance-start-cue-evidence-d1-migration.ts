/** Apply immutable dance start-cue evidence across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1153_dance_attempt_start_cue_evidence.sql",
  label: "community-template",
  requiredTables: ["dance_attempt"],
  creates: {
    kind: "columns_by_table",
    columns: [
      { table: "dance_attempt", column: "start_cue_policy_version" },
      { table: "dance_attempt", column: "start_cue_kind" },
      { table: "dance_attempt", column: "start_cue_outcome" },
      { table: "dance_attempt", column: "scored_window_start_ms" },
    ],
  },
  replayableDdl: false,
  description: "Immutable start-cue evidence and the cue-excluded scoring boundary.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-dance-start-cue-evidence-d1-migration.ts",
  )
}
