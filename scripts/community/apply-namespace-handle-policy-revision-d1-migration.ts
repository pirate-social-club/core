/**
 * Operator spec for applying community-template migration
 * 1141_namespace_handle_policy_revision.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1141_namespace_handle_policy_revision.sql",
  label: "community-template",
  requiredTables: ["namespace_handle_policies"],
  creates: {
    kind: "schema_objects",
    columns: [{ table: "namespace_handle_policies", column: "revision" }],
    indexes: [],
  },
  replayableDdl: false,
  description: "Monotonic revisions for optimistic handle-policy updates.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-namespace-handle-policy-revision-d1-migration.ts",
  )
}
