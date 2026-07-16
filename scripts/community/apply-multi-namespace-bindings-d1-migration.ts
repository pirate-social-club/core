/** Apply migration 1133 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1133_multi_namespace_bindings.sql",
  label: "community-template",
  requiredTables: ["namespace_bindings"],
  creates: {
    kind: "schema_objects",
    columns: [{ table: "namespace_bindings", column: "namespace_role" }],
    indexes: [
      "idx_namespace_bindings_active_primary_community",
      "idx_namespace_bindings_active_verification",
    ],
  },
  replayableDdl: false,
  description: "Allow one primary namespace and multiple independently verified mirrors per community.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-multi-namespace-bindings-d1-migration.ts",
  )
}
