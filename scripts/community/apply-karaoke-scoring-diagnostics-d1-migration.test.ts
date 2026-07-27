import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-karaoke-scoring-diagnostics-d1-migration"

describe("karaoke scoring diagnostics fleet migration", () => {
  test("attests the derived diagnostics column consumed by the API", () => {
    expect(SPEC.migration).toBe("1144_karaoke_scoring_diagnostics.sql")
    expect(SPEC.requiredTables).toEqual(["karaoke_attempt"])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns).toEqual([
      { table: "karaoke_attempt", column: "scoring_diagnostics_json" },
    ])
    expect(SPEC.creates.indexes).toEqual([])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
