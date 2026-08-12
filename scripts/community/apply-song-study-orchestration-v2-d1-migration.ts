/** Apply server-owned Song Study orchestration persistence across the D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1151_song_study_orchestration_v2.sql",
  label: "community-template",
  requiredTables: ["song_study_session", "song_study_session_exercise"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "song_study_session", column: "session_revision" },
      { table: "song_study_session", column: "current_exercise_id" },
      { table: "song_study_session", column: "completion_reason" },
      { table: "song_study_session_exercise", column: "appearance_ordinal" },
      { table: "song_study_session_exercise", column: "appearance_attempt_count" },
      { table: "song_study_session_exercise", column: "lesson_resolved" },
      { table: "song_study_session_exercise", column: "last_served_index" },
      { table: "song_study_session_exercise", column: "qualifies_for_reward" },
      { table: "song_study_attempt_response", column: "commit_token" },
      { table: "song_study_attempt_response", column: "response_status" },
    ],
    tables: ["song_study_ungradable_receipt", "song_study_attempt_response"],
    indexes: ["idx_song_study_attempt_response_session"],
  },
  replayableDdl: false,
  description: "Durable revision, appearance, reward, and idempotent Song Study orchestration state.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-song-study-orchestration-v2-d1-migration.ts",
  )
}
