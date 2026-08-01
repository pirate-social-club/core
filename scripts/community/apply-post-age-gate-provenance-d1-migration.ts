/** Apply durable post age-gate provenance across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const LEDGER_BACKFILL_SQL = `
UPDATE posts
SET age_gate_source = 'legacy_unknown',
    age_gate_set_at = updated_at
WHERE age_gate_policy = '18_plus'
  AND age_gate_source IS NULL;
`

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
  ledgerBackfillSql: LEDGER_BACKFILL_SQL,
  description: "Durable provenance for post age-gate policy decisions.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-post-age-gate-provenance-d1-migration.ts",
  )
}
