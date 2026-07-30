/** Admit permanent upload_invalid attempt rejection across the D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1147_dance_attempt_upload_invalid_reason.sql",
  label: "community-template",
  requiredTables: ["dance_attempt"],
  creates: {
    kind: "table_sql_contains",
    table: "dance_attempt",
    fragments: ["upload_invalid", "insufficient_alignment"],
  },
  replayableDdl: false,
  description: "Permanent hash-bound dance upload rejection evidence.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-dance-attempt-upload-invalid-d1-migration.ts",
  )
}
