import type { BookingAllocation, BookingPolicy, Cents } from "./types";

// Settlement pays by amountCents from the allocation legs — it MUST NOT recompute from
// shareBps. shareBps is the snapshot of the split ratio; amountCents is the rounded money
// that actually moves. For sub-cent fees (e.g. gross=1¢, feeBps=1000 → fee=0¢, host=1¢),
// the effective fee rate is 0% despite shareBps=1000. That is intentional: the residual
// always goes to the host, and the platform absorbs the rounding loss.

function halfUpRoundCents(grossCents: Cents, feeBps: number): Cents {
  // Integer half-up rounding: floor((gross * feeBps + 5000) / 10000)
  // The +5000 (half of 10000) provides the tiebreak for 0.5 cases.
  return Math.floor((grossCents * feeBps + 5000) / 10000);
}

export function computeAllocation(grossCents: Cents, policy: BookingPolicy): BookingAllocation {
  const feeBps = policy.platformFeeBps;
  const hostBps = 10000 - feeBps;
  const platformFeeCents = halfUpRoundCents(grossCents, feeBps);
  const hostPayoutCents = grossCents - platformFeeCents;
  return {
    legs: [
      {
        recipientType: "host",
        shareBps: hostBps,
        amountCents: hostPayoutCents,
        settlementStrategy: "operator_payout",
      },
      {
        recipientType: "platform_fee",
        shareBps: feeBps,
        amountCents: platformFeeCents,
        settlementStrategy: "platform_fee_payout",
      },
    ],
  };
}
