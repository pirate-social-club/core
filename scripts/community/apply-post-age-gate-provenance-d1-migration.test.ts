import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-post-age-gate-provenance-d1-migration"

describe("post age-gate provenance fleet migration", () => {
  test("attests all three post provenance columns", () => {
    expect(SPEC.migration).toBe("1148_post_age_gate_provenance.sql")
    expect(SPEC.requiredTables).toEqual(["posts"])
    expect(SPEC.creates).toEqual({
      kind: "columns",
      table: "posts",
      columns: ["age_gate_source", "age_gate_evidence_ref", "age_gate_set_at"],
    })
    expect(SPEC.replayableDdl).toBe(false)
  })
})
