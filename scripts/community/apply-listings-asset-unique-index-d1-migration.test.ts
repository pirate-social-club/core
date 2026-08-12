import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-listings-asset-unique-index-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("listings asset uniqueness fleet migration", () => {
  test("classifies the replacement index and refuses automatic replay", () => {
    expect(SPEC.migration).toBe("1155_listings_asset_unique_index.sql")
    expect(SPEC.requiredTables).toEqual(["listings"])
    expect(SPEC.creates).toEqual({
      kind: "schema_objects",
      columns: [],
      indexes: ["idx_listings_community_asset_unique"],
    })
    expect(SPEC.replayableDdl).toBe(false)
    expect(classificationSql(SPEC)).toContain("idx_listings_community_asset_unique")
  })
})
