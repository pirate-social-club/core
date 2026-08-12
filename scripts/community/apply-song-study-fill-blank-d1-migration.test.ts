import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-song-study-fill-blank-d1-migration"
import { classificationSql, classifyRow } from "./lib/fleet-d1-migration"

const CHECKSUM = "a".repeat(64)

function row(overrides: Record<string, number | string> = {}) {
  return {
    has_ledger: 1,
    ledger_checksum: "",
    req_song_study_unit: 1,
    req_song_study_attempt: 1,
    req_song_study_review_state: 1,
    obj_song_study_attempt__placements_json: 0,
    obj_index__idx_song_study_unit_cloze_status: 0,
    obj_table__song_study_unit_cloze: 0,
    obj_table_fragment__song_study_attempt__0: 0,
    obj_table_fragment__song_study_review_state__0: 0,
    final_index__idx_song_study_attempt_review_unit: 1,
    final_index__idx_song_study_attempt_session_presentation: 1,
    final_index__idx_song_study_review_due: 1,
    metric_rows__song_study_attempt: 0,
    metric_rows__song_study_review_state: 0,
    ...overrides,
  }
}

describe("song study fill-blank fleet migration", () => {
  test("probes both rebuilt CHECKs, the new payload column, and cloze storage", () => {
    const sql = classificationSql(SPEC)
    expect(sql).toContain("pragma_table_info('song_study_attempt')")
    expect(sql).toContain("name='placements_json'")
    expect(sql).toContain("name='song_study_unit_cloze'")
    expect(sql).toContain("name='idx_song_study_unit_cloze_status'")
    expect(sql).toContain("final_index__idx_song_study_attempt_review_unit")
    expect(sql).toContain("final_index__idx_song_study_attempt_session_presentation")
    expect(sql).toContain("final_index__idx_song_study_review_due")
    expect(sql).toContain("name='song_study_attempt' AND instr(lower(sql), lower('''fill_blank''')) > 0")
    expect(sql).toContain("name='song_study_review_state' AND instr(lower(sql), lower('''fill_blank''')) > 0")
  })

  test("records attempt and review-state volume in the classification query", () => {
    const sql = classificationSql(SPEC)
    expect(sql).toContain("COUNT(*) FROM 'song_study_attempt'")
    expect(sql).toContain("COUNT(*) FROM 'song_study_review_state'")
  })

  test("classifies the untouched pre-migration schema as needing migration", () => {
    expect(classifyRow(SPEC, row(), CHECKSUM)).toEqual({ status: "needs_migration" })
  })

  test("blocks every partially rebuilt combination", () => {
    const partial = row({
      obj_song_study_attempt__placements_json: 1,
      obj_table_fragment__song_study_attempt__0: 1,
    })
    expect(classifyRow(SPEC, partial, CHECKSUM)).toEqual({
      status: "partial_objects",
      detail: "present: song_study_attempt__placements_json, table_fragment__song_study_attempt__0",
    })
  })

  test("blocks complete markers when a rebuilt-table index is missing", () => {
    const missingIndex = row({
      obj_song_study_attempt__placements_json: 1,
      obj_index__idx_song_study_unit_cloze_status: 1,
      obj_table__song_study_unit_cloze: 1,
      obj_table_fragment__song_study_attempt__0: 1,
      obj_table_fragment__song_study_review_state__0: 1,
      final_index__idx_song_study_attempt_session_presentation: 0,
    })
    expect(classifyRow(SPEC, missingIndex, CHECKSUM)).toEqual({
      status: "partial_objects",
      detail: "missing final invariant(s): index__idx_song_study_attempt_session_presentation",
    })
  })

  test("accepts only the complete schema with the exact ledger checksum", () => {
    const complete = row({
      ledger_checksum: CHECKSUM,
      obj_song_study_attempt__placements_json: 1,
      obj_index__idx_song_study_unit_cloze_status: 1,
      obj_table__song_study_unit_cloze: 1,
      obj_table_fragment__song_study_attempt__0: 1,
      obj_table_fragment__song_study_review_state__0: 1,
    })
    expect(classifyRow(SPEC, complete, CHECKSUM)).toEqual({ status: "ok_recorded" })
  })
})
