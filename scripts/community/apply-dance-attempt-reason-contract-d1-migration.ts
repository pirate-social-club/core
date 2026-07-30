/** Widen the dance-attempt scorer rejection contract across the D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1146_dance_attempt_reason_contract.sql",
  label: "community-template",
  requiredTables: ["dance_attempt"],
  creates: {
    kind: "table_sql_contains",
    table: "dance_attempt",
    fragments: ["insufficient_motion", "insufficient_alignment"],
  },
  replayableDdl: false,
  description: "Scorer-v1 motion and alignment rejection reasons.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-dance-attempt-reason-contract-d1-migration.ts",
  )
}
