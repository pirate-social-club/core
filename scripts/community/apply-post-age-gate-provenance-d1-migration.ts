/** Apply community-template migration 1148 across the allocated+loaded D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1148_post_age_gate_provenance.sql",
  label: "community-template",
  requiredTables: ["posts"],
  creates: {
    kind: "columns",
    table: "posts",
    columns: ["age_gate_source", "age_gate_evidence_ref", "age_gate_set_at"],
  },
  replayableDdl: false,
  description: "Durable source, evidence reference, and first-set timestamp for post age gates.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-post-age-gate-provenance-d1-migration.ts",
  )
}
