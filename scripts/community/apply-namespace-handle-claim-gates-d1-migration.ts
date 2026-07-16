/**
 * Operator spec for applying community-template migration
 * 1135_namespace_handle_claim_gates.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1135_namespace_handle_claim_gates.sql",
  label: "community-template",
  requiredTables: ["namespace_handle_policies"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "namespace_handle_policies", column: "claim_gate_mode" },
      { table: "namespace_handle_policies", column: "claim_gate_expression_ref" },
      { table: "namespace_handle_policies", column: "eligibility_timing" },
      { table: "namespace_handle_claim_gate_policies", column: "claim_gate_expression_ref" },
      { table: "namespace_handle_claim_gate_policies", column: "namespace_handle_policy_id" },
      { table: "namespace_handle_claim_gate_policies", column: "version" },
      { table: "namespace_handle_claim_gate_policies", column: "expression_json" },
      { table: "namespace_handle_claim_gate_policies", column: "created_at" },
      { table: "namespace_handle_claim_gate_policies", column: "updated_at" },
    ],
    indexes: ["idx_namespace_handle_claim_gate_policies_updated"],
  },
  replayableDdl: false,
  description: "Namespace-local handle claim gate modes and versioned eligibility expressions.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-namespace-handle-claim-gates-d1-migration.ts",
  )
}
