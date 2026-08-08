import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-user-account-merge-receipts-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("user account merge receipt fleet migration", () => {
  test("pins the receipt table and its prerequisite data surfaces", () => {
    expect(SPEC.migration).toBe("1152_user_account_merge_receipts.sql")
    expect(SPEC.creates).toEqual({
      kind: "schema_objects",
      columns: [],
      tables: ["user_account_merge_receipts"],
      indexes: ["idx_user_account_merge_receipts_canonical"],
    })
    expect(classificationSql(SPEC)).toContain("user_account_merge_receipts")
    expect(SPEC.requiredTables).toContain("song_study_review_state")
    expect(SPEC.requiredTables).toContain("reward_qualification_outbox")
    expect(SPEC.replayableDdl).toBe(false)
  })
})
