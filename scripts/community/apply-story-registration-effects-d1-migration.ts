/** Apply migration 1129 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1129_story_registration_effects.sql",
  label: "community-template",
  requiredTables: ["communities"],
  creates: {
    kind: "tables",
    tables: ["story_registration_effects"],
  },
  replayableDdl: true,
  description: "Durable Story registration effect journal and reconciliation indexes.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-story-registration-effects-d1-migration.ts",
  )
}
