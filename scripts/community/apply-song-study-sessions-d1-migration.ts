/** Apply the server-owned song-study session schema across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1142_song_study_sessions.sql",
  label: "community-template",
  requiredTables: [
    "song_study_unit",
    "song_study_unit_localization",
    "song_study_attempt",
    "posts",
    "communities",
  ],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "song_study_attempt", column: "study_session_id" },
      { table: "song_study_attempt", column: "presentation_number" },
    ],
    indexes: [
      "idx_song_study_session_active",
      "idx_song_study_session_expiry",
      "idx_song_study_session_exercise_queue",
      "idx_song_study_attempt_session_presentation",
    ],
  },
  replayableDdl: false,
  description: "Server-owned, capped song-study sessions and logical presentation identity.",
}

if (import.meta.main) {
  await runFleetMigration(SPEC, "scripts/community/apply-song-study-sessions-d1-migration.ts")
}
