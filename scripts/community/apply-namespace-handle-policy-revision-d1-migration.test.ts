import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-namespace-handle-policy-revision-d1-migration"

describe("namespace handle-policy revision fleet migration", () => {
  test("attests the revision column consumed by the API", () => {
    expect(SPEC.migration).toBe("1141_namespace_handle_policy_revision.sql")
    expect(SPEC.requiredTables).toEqual(["namespace_handle_policies"])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns).toEqual([
      { table: "namespace_handle_policies", column: "revision" },
    ])
    expect(SPEC.creates.indexes).toEqual([])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
