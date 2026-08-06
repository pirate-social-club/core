import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-song-study-orchestration-v2-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("Song Study orchestration v2 fleet migration", () => {
  test("attests every API-consumed column, table, and index", () => {
    expect(SPEC.migration).toBe("1151_song_study_orchestration_v2.sql")
    expect(SPEC.requiredTables).toEqual(["song_study_session", "song_study_session_exercise"])
    expect(SPEC.creates.kind).toBe("schema_objects")
    if (SPEC.creates.kind !== "schema_objects") throw new Error("schema object attestation required")
    expect(SPEC.creates.columns).toHaveLength(9)
    expect(SPEC.creates.columns).toContainEqual({
      table: "song_study_attempt_response",
      column: "commit_token",
    })
    expect(SPEC.creates.tables).toEqual([
      "song_study_ungradable_receipt",
      "song_study_attempt_response",
    ])
    expect(SPEC.creates.indexes).toEqual(["idx_song_study_attempt_response_session"])
    expect(SPEC.replayableDdl).toBe(false)

    const sql = classificationSql(SPEC)
    expect(sql).toContain("obj_table__song_study_ungradable_receipt")
    expect(sql).toContain("obj_table__song_study_attempt_response")
    expect(sql).toContain("obj_song_study_attempt_response__commit_token")
  })
})
