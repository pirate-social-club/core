/** Apply migration 1140 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1140_karaoke_attempts_schema_repair.sql",
  label: "community-template",
  requiredTables: ["communities", "posts"],
  creates: {
    kind: "tables",
    tables: ["karaoke_attempt"],
  },
  replayableDdl: true,
  description: "Repair divergent 1123 lineage and restore durable karaoke attempts.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-karaoke-attempt-schema-repair-d1-migration.ts",
  )
}
