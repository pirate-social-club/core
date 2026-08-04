import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-live-room-audience-gates-d1-migration"

describe("Live-room audience-gates fleet migration", () => {
  test("positively attests the column consumed by the API", () => {
    expect(SPEC.migration).toBe("1122_live_room_audience_gates.sql")
    expect(SPEC.requiredTables).toEqual(["live_rooms"])
    expect(SPEC.creates).toEqual({
      kind: "schema_objects",
      columns: [{ table: "live_rooms", column: "audience_gate_json" }],
      indexes: [],
    })
    expect(SPEC.replayableDdl).toBe(false)
  })
})
