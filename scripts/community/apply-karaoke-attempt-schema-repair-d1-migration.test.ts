import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-karaoke-attempt-schema-repair-d1-migration"

describe("karaoke attempt schema-repair fleet migration", () => {
  test("targets the replay-safe repair migration", () => {
    expect(SPEC.migration).toBe("1140_karaoke_attempts_schema_repair.sql")
    expect(SPEC.creates).toEqual({ kind: "tables", tables: ["karaoke_attempt"] })
    expect(SPEC.replayableDdl).toBe(true)
  })
})
