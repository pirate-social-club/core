import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "db/control-plane/migrations/0234_control_plane_reward_ticket_claim_net_accounting.sql",
  "utf8",
)

describe("reward ticket claim net accounting migration", () => {
  test("conserves gross payout across custody proceeds and referral accrual", () => {
    expect(migration).toContain(
      "gross_tier_payout_atomic = received_amount_atomic + referral_accrual_atomic",
    )
    expect(migration).toContain("protocol_reported_winnings_atomic = received_amount_atomic")
    expect(migration).toContain(
      "source_referral_accrual_atomic IS DISTINCT FROM NEW.amount_atomic",
    )
  })

  test("freezes the new accounting evidence after finality", () => {
    expect(migration).toContain("NEW.gross_tier_payout_atomic")
    expect(migration).toContain("NEW.referral_accrual_atomic")
    expect(migration).toContain("finalized reward ticket claim receipt is immutable")
  })
})
