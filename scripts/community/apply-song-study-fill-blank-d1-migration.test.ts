import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-song-study-fill-blank-d1-migration"
import {
  classificationSql,
  classifyRow,
  ledgerWithoutObjectsRepairBody,
  planLedgerWithoutObjectsRepair,
  rowCountSql,
} from "./lib/fleet-d1-migration"

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
    forbidden_table__song_study_attempt_next: 0,
    forbidden_table__song_study_review_state_next: 0,
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
    expect(sql).toContain("forbidden_table__song_study_attempt_next")
    expect(sql).toContain("forbidden_table__song_study_review_state_next")
    expect(sql).toContain("name='song_study_attempt' AND instr(lower(sql), lower('''fill_blank''')) > 0")
    expect(sql).toContain("name='song_study_review_state' AND instr(lower(sql), lower('''fill_blank''')) > 0")
  })

  test("counts attempt and review-state volume only after schema classification", () => {
    const sql = classificationSql(SPEC)
    expect(sql).not.toContain("COUNT(*) FROM 'song_study_attempt'")
    expect(sql).not.toContain("COUNT(*) FROM 'song_study_review_state'")
    const counts = rowCountSql(SPEC)
    expect(counts).toContain("COUNT(*) FROM 'song_study_attempt'")
    expect(counts).toContain("COUNT(*) FROM 'song_study_review_state'")
  })

  test("classifies the untouched pre-migration schema as needing migration", () => {
    expect(classifyRow(SPEC, row(), CHECKSUM)).toEqual({ status: "needs_migration" })
  })

  test("repairs only the exact ledger-without-objects state behind both opt-ins", () => {
    const ledgerOnly = classifyRow(SPEC, row({ ledger_checksum: CHECKSUM }), CHECKSUM)
    expect(ledgerOnly.status).toBe("ledger_without_objects")
    expect(planLedgerWithoutObjectsRepair(SPEC, ledgerOnly.status, false)).toBe("ledger_without_objects")
    expect(planLedgerWithoutObjectsRepair(SPEC, ledgerOnly.status, true)).toBe("needs_ledger_repair")
    expect(
      planLedgerWithoutObjectsRepair(
        { ...SPEC, repairLedgerWithoutObjects: false },
        ledgerOnly.status,
        true,
      ),
    ).toBe("ledger_without_objects")
    expect(
      planLedgerWithoutObjectsRepair(
        SPEC,
        classifyRow(SPEC, row({ ledger_checksum: "b".repeat(64) }), CHECKSUM).status,
        true,
      ),
    ).toBe("checksum_mismatch")
  })

  test("repair replays the original migration without duplicating or rewriting its ledger row", async () => {
    const sql = await Bun.file(
      new URL("../../db/community-template/migrations/1156_song_study_fill_blank.sql", import.meta.url),
    ).text()
    const body = ledgerWithoutObjectsRepairBody(sql)
    expect(body.startsWith(sql.trim())).toBe(true)
    expect(body).toContain("CREATE TABLE song_study_unit_cloze")
    expect(body).not.toContain("INSERT INTO schema_migrations")
    expect(body).not.toContain("DELETE FROM schema_migrations")
    expect(body).not.toContain("UPDATE schema_migrations")
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

  test("names an orphaned rebuild table in the partial-state diagnostic", () => {
    expect(classifyRow(SPEC, row({ forbidden_table__song_study_attempt_next: 1 }), CHECKSUM)).toEqual({
      status: "partial_objects",
      detail: "forbidden intermediate object(s): table__song_study_attempt_next",
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
