import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-community-handle-claim-intents-d1-migration"

describe("community handle claim-intent fleet migration", () => {
  test("positively attests every object created by the migration", () => {
    expect(SPEC.migration).toBe("1157_community_handle_claim_intents.sql")
    expect(SPEC.requiredTables).toEqual([
      "community_handle_claim_quotes",
      "community_handle_label_reservations",
      "community_handles",
    ])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns.map(({ table, column }) => `${table}.${column}`)).toEqual([
      "community_handle_claim_quotes.handle_claim_intent_id",
      "community_handle_label_reservations.handle_claim_intent_id",
      "community_handles.handle_claim_intent_id",
    ])
    expect(SPEC.creates.indexes).toEqual([
      "idx_community_handle_claim_quotes_intent",
      "idx_community_handle_label_reservations_active_intent",
      "idx_community_handles_claim_intent_once",
    ])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
