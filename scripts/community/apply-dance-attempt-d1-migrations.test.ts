import { describe, expect, test } from "bun:test"

import { SPEC as ATTEMPTS } from "./apply-dance-attempts-d1-migration"
import { SPEC as REASONS } from "./apply-dance-attempt-reason-contract-d1-migration"
import { SPEC as START_CUE } from "./apply-dance-start-cue-evidence-d1-migration"
import { SPEC as UPLOAD_INVALID } from "./apply-dance-attempt-upload-invalid-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("dance attempt fleet migrations", () => {
  test("rolls the four immutable schema revisions in order", () => {
    expect([
      ATTEMPTS.migration,
      REASONS.migration,
      UPLOAD_INVALID.migration,
      START_CUE.migration,
    ]).toEqual([
      "1145_dance_attempts.sql",
      "1146_dance_attempt_reason_contract.sql",
      "1147_dance_attempt_upload_invalid_reason.sql",
      "1153_dance_attempt_start_cue_evidence.sql",
    ])
    expect(ATTEMPTS.requiredTables).toEqual(["posts", "communities"])
    expect(REASONS.requiredTables).toEqual(["dance_attempt"])
    expect(UPLOAD_INVALID.requiredTables).toEqual(["dance_attempt"])
    expect(START_CUE.requiredTables).toEqual(["dance_attempt"])
    expect(ATTEMPTS.replayableDdl).toBe(false)
    expect(REASONS.replayableDdl).toBe(false)
    expect(UPLOAD_INVALID.replayableDdl).toBe(false)
    expect(START_CUE.replayableDdl).toBe(false)
  })

  test("attests the table and both successive bounded reason contracts", () => {
    expect(classificationSql(ATTEMPTS)).toContain("obj_dance_attempt")
    expect(classificationSql(REASONS)).toContain("insufficient_motion")
    expect(classificationSql(REASONS)).toContain("insufficient_alignment")
    expect(classificationSql(UPLOAD_INVALID)).toContain("upload_invalid")
    expect(classificationSql(UPLOAD_INVALID)).not.toContain("insufficient_alignment")
    expect(classificationSql(START_CUE)).toContain("start_cue_policy_version")
    expect(classificationSql(START_CUE)).toContain("start_cue_kind")
    expect(classificationSql(START_CUE)).toContain("start_cue_outcome")
    expect(classificationSql(START_CUE)).toContain("scored_window_start_ms")
  })
})
