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
    const sql = classificationSql(SPEC)
    expect(sql).toContain("user_account_merge_receipts")
    expect(sql).not.toContain(",\n  ,")
    expect(SPEC.requiredTables).toEqual([])
    expect(SPEC.replayableDdl).toBe(false)
  })
})
