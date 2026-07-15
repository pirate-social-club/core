/** Apply migration 1131 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1131_song_study_generation_runs.sql",
  label: "community-template",
  requiredTables: ["posts", "community_jobs"],
  creates: {
    kind: "tables",
    tables: ["song_study_generation_run"],
  },
  replayableDdl: false,
  description: "Durable, convergent song study generation runs.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-song-study-generation-runs-d1-migration.ts",
  )
}
