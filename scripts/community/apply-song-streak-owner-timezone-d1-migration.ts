/** Apply owner-timezone song streak boundaries across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1149_song_streak_owner_timezone.sql",
  label: "community-template",
  requiredTables: ["song_streaks"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "song_streaks", column: "timezone" },
      { table: "song_streaks", column: "timezone_updated_at" },
      { table: "song_streaks", column: "active_until_at" },
    ],
    indexes: ["idx_song_streaks_active"],
  },
  replayableDdl: false,
  description: "Owner-timezone day boundaries and active streak expiry.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-song-streak-owner-timezone-d1-migration.ts",
  )
}
