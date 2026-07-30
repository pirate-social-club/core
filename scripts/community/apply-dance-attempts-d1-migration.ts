/** Apply immutable dance-attempt evidence tables across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1145_dance_attempts.sql",
  label: "community-template",
  requiredTables: ["posts", "communities"],
  creates: {
    kind: "tables",
    tables: ["dance_attempt"],
  },
  replayableDdl: false,
  description: "Immutable, bounded dance grading evidence and validation triggers.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-dance-attempts-d1-migration.ts",
  )
}
