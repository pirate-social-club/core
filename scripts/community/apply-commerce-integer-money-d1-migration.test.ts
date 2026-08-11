import { describe, expect, test } from "bun:test"
import { SPEC } from "./apply-commerce-integer-money-d1-migration"
import { classificationSql } from "./lib/fleet-d1-migration"

describe("commerce integer-money fleet migration", () => {
  test("classifies every rebuilt money column and refuses automatic replay", () => {
    expect(SPEC.migration).toBe("1154_commerce_integer_money.sql")
    expect(SPEC.requiredTables).toEqual([
      "listings",
      "purchase_quotes",
      "purchases",
      "purchase_allocation_legs",
    ])
    expect(SPEC.replayableDdl).toBe(false)

    const sql = classificationSql(SPEC)
    for (const column of [
      "price_cents",
      "base_price_cents",
      "final_price_cents",
      "purchase_price_cents",
      "donation_share_bps",
      "donation_amount_cents",
      "amount_cents",
    ]) {
      expect(sql).toContain(column)
    }
  })
})
