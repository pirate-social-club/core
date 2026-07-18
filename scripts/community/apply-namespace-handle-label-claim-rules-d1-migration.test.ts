import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-namespace-handle-label-claim-rules-d1-migration"

describe("namespace handle label-claim-rule fleet migration", () => {
  test("positively attests every object consumed by the API", () => {
    expect(SPEC.migration).toBe("1138_namespace_handle_label_claim_rules.sql")
    expect(SPEC.requiredTables).toEqual([
      "namespace_handle_policies",
      "namespace_handle_claim_gate_policies",
    ])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns.map(({ table, column }) => `${table}.${column}`)).toContain(
      "namespace_handle_label_claim_rules.expression_json",
    )
    expect(SPEC.creates.indexes).toEqual([
      "idx_namespace_handle_label_claim_rules_position",
      "idx_namespace_handle_label_claim_rules_updated",
    ])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
