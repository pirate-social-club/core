import { describe, expect, test } from "bun:test"

import { SPEC } from "./apply-post-age-gate-provenance-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("post age-gate provenance fleet migration", () => {
  test("targets migration 1148 and requires the posts table", () => {
    expect(SPEC.migration).toBe("1148_post_age_gate_provenance.sql")
    expect(SPEC.requiredTables).toEqual(["posts"])
    expect(SPEC.replayableDdl).toBe(false)
  })

  test("attests all three provenance columns", () => {
    const sql = classificationSql(SPEC)

    expect(sql).toContain("age_gate_source")
    expect(sql).toContain("age_gate_evidence_ref")
    expect(sql).toContain("age_gate_set_at")
  })
})
