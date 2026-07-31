/** Apply durable post age-gate provenance across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1148_post_age_gate_provenance.sql",
  label: "community-template",
  requiredTables: ["posts"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "posts", column: "age_gate_source" },
      { table: "posts", column: "age_gate_evidence_ref" },
      { table: "posts", column: "age_gate_set_at" },
    ],
    indexes: [],
  },
  replayableDdl: false,
  description: "Durable provenance for post age-gate policy decisions.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-post-age-gate-provenance-d1-migration.ts",
  )
}
