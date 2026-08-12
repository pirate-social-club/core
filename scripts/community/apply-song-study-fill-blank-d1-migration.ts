/** Apply persisted Song Study fill-blank support across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1156_song_study_fill_blank.sql",
  label: "community-template",
  requiredTables: ["song_study_unit", "song_study_attempt", "song_study_review_state"],
  creates: {
    kind: "schema_objects",
    columns: [{ table: "song_study_attempt", column: "placements_json" }],
    indexes: ["idx_song_study_unit_cloze_status"],
    finalIndexes: [
      "idx_song_study_attempt_review_unit",
      "idx_song_study_attempt_session_presentation",
      "idx_song_study_review_due",
    ],
    tables: ["song_study_unit_cloze"],
    tableSqlContains: [
      { table: "song_study_attempt", fragments: ["'fill_blank'"] },
      { table: "song_study_review_state", fragments: ["'fill_blank'"] },
    ],
  },
  // Audit manifests use these counts to select the highest-volume canary and
  // execution manifests retain them beside the measured rebuild duration.
  rowCountTables: ["song_study_attempt", "song_study_review_state"],
  // Two populated tables are rebuilt. Any partial state must be investigated
  // and rolled forward rather than replayed automatically.
  replayableDdl: false,
  description: "Persisted cloze definitions and widened fill-blank attempt/review discriminators.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-song-study-fill-blank-d1-migration.ts",
  )
}
