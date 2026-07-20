import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-song-study-sessions-d1-migration"

describe("song-study sessions fleet migration", () => {
  test("attests the tables, attempt identity columns, and indexes consumed by the API", () => {
    expect(SPEC.migration).toBe("1142_song_study_sessions.sql")
    expect(SPEC.requiredTables).toContain("song_study_attempt")
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns).toEqual([
      { table: "song_study_attempt", column: "study_session_id" },
      { table: "song_study_attempt", column: "presentation_number" },
    ])
    expect(SPEC.creates.indexes).toContain("idx_song_study_attempt_session_presentation")
    expect(SPEC.replayableDdl).toBe(false)
  })
})
