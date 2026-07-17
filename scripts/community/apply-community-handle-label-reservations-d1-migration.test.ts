import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-community-handle-label-reservations-d1-migration"

describe("community handle label-reservation fleet migration", () => {
  test("positively attests every object consumed by the API", () => {
    expect(SPEC.migration).toBe("1136_community_handle_label_reservations.sql")
    expect(SPEC.requiredTables).toEqual([
      "communities",
      "community_handle_claim_quotes",
      "community_handles",
      "namespace_bindings",
    ])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns.map(({ table, column }) => `${table}.${column}`)).toContain(
      "community_handle_label_reservations.handle_claim_quote_id",
    )
    expect(SPEC.creates.indexes).toEqual([
      "idx_community_handle_label_reservations_active_label",
      "idx_community_handle_label_reservations_active_expiry",
    ])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
