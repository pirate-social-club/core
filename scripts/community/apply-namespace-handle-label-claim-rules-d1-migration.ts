/**
 * Operator spec for applying community-template migration
 * 1138_namespace_handle_label_claim_rules.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1138_namespace_handle_label_claim_rules.sql",
  label: "community-template",
  requiredTables: ["namespace_handle_policies", "namespace_handle_claim_gate_policies"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "namespace_handle_label_claim_rules", column: "label_claim_rule_id" },
      { table: "namespace_handle_label_claim_rules", column: "namespace_handle_policy_id" },
      { table: "namespace_handle_label_claim_rules", column: "position" },
      { table: "namespace_handle_label_claim_rules", column: "selector_type" },
      { table: "namespace_handle_label_claim_rules", column: "selector_labels_json" },
      { table: "namespace_handle_label_claim_rules", column: "version" },
      { table: "namespace_handle_label_claim_rules", column: "expression_json" },
      { table: "namespace_handle_label_claim_rules", column: "created_at" },
      { table: "namespace_handle_label_claim_rules", column: "updated_at" },
    ],
    indexes: [
      "idx_namespace_handle_label_claim_rules_position",
      "idx_namespace_handle_label_claim_rules_updated",
    ],
  },
  replayableDdl: false,
  description: "Ordered per-label claim eligibility rules for namespace handle policies.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-namespace-handle-label-claim-rules-d1-migration.ts",
  )
}
