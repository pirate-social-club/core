import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-story-registration-durable-request-d1-migration"

describe("Story registration durable-request fleet migration", () => {
  test("positively attests the column consumed by the API", () => {
    expect(SPEC.migration).toBe("1139_story_registration_durable_request.sql")
    expect(SPEC.requiredTables).toEqual(["story_registration_effects"])
    expect(SPEC.creates).toEqual({
      kind: "schema_objects",
      columns: [{ table: "story_registration_effects", column: "durable_request_json" }],
      indexes: [],
    })
    expect(SPEC.replayableDdl).toBe(false)
  })
})
