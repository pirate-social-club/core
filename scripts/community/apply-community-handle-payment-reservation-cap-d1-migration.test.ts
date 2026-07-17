import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-community-handle-payment-reservation-cap-d1-migration"

describe("community handle payment-reservation cap fleet migration", () => {
  test("attests the partial unique per-user payment index", () => {
    expect(SPEC.migration).toBe("1137_community_handle_payment_reservation_cap.sql")
    expect(SPEC.requiredTables).toEqual(["community_handle_label_reservations"])
    expect(SPEC.creates).toEqual({
      kind: "schema_objects",
      columns: [],
      indexes: ["idx_community_handle_label_reservations_active_payment_user"],
    })
    expect(SPEC.replayableDdl).toBe(false)
  })
})
