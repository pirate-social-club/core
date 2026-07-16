import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-namespace-handle-claim-gates-d1-migration"

describe("namespace handle claim-gate fleet migration", () => {
  test("positively attests every object consumed by the API", () => {
    expect(SPEC.migration).toBe("1135_namespace_handle_claim_gates.sql")
    expect(SPEC.requiredTables).toEqual(["namespace_handle_policies"])
    expect(SPEC.creates).toEqual({
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
    })
    expect(SPEC.replayableDdl).toBe(false)
  })
})
