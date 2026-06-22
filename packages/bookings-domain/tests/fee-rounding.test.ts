import { describe, expect, test } from "bun:test";
import { computeAllocation } from "../src/allocation";
import type { BookingAllocation, BookingPolicy } from "../src/types";

const tenPctHalfUp: BookingPolicy = {
  platformFeeBps: 1000, // 10%
  holdTtlSeconds: 600,
  minLeadTimeSeconds: 3600,
  maxAdvanceSeconds: 60 * 86400,
  cancellationWindowSeconds: 86400,
  noShowGraceSeconds: 600,
  refundPolicy: {
    bookerCancelAfterWindowRefundBps: 0,
    noShowByBookerRefundBps: 0,
    noShowByHostRefundBps: 10000,
  },
  rounding: "half_up",
};

function feeCents(a: BookingAllocation): number {
  const leg = a.legs.find((l) => l.recipientType === "platform_fee");
  if (!leg) throw new Error("missing platform_fee leg");
  return leg.amountCents;
}

function hostCents(a: BookingAllocation): number {
  const leg = a.legs.find((l) => l.recipientType === "host");
  if (!leg) throw new Error("missing host leg");
  return leg.amountCents;
}

describe("fee math — 10% of common amounts", () => {
  test("$50.00 -> fee $5.00 / host $45.00", () => {
    const a = computeAllocation(5000, tenPctHalfUp);
    expect(feeCents(a)).toBe(500);
    expect(hostCents(a)).toBe(4500);
  });
});

describe("fee math — odd amounts where rounding bites", () => {
  test("$33.33 -> fee 333 / host 3000 (half_up)", () => {
    const a = computeAllocation(3333, tenPctHalfUp);
    expect(feeCents(a)).toBe(333); // round(333.3) = 333
    expect(hostCents(a)).toBe(3000); // 3333 - 333
  });

  test("$0.01 -> fee 0 / host 1", () => {
    const a = computeAllocation(1, tenPctHalfUp);
    expect(feeCents(a)).toBe(0); // round(0.1) = 0
    expect(hostCents(a)).toBe(1);
  });

  test("5 cents -> fee 1 / host 4 (half_up rounds 0.5 up)", () => {
    const a = computeAllocation(5, tenPctHalfUp);
    expect(feeCents(a)).toBe(1); // round(0.5) = 1 (half_up)
    expect(hostCents(a)).toBe(4);
  });
});

describe("fee math — invariant (fuzzed range)", () => {
  test("platformFeeCents + hostPayoutCents === grossCents for 1..100000", () => {
    for (let gross = 1; gross <= 100000; gross += 1) {
      const a = computeAllocation(gross, tenPctHalfUp);
      expect(feeCents(a) + hostCents(a)).toBe(gross);
    }
  });

  test("allocation legs: sum(shareBps) === 10000 and sum(amountCents) === gross", () => {
    for (let gross = 1; gross <= 100000; gross += 997) {
      const a = computeAllocation(gross, tenPctHalfUp);
      const shareSum = a.legs.reduce((acc, l) => acc + l.shareBps, 0);
      const amountSum = a.legs.reduce((acc, l) => acc + l.amountCents, 0);
      expect(shareSum).toBe(10000);
      expect(amountSum).toBe(gross);
    }
  });

  test("legs have exactly one host and one platform_fee with correct strategies", () => {
    const a = computeAllocation(5000, tenPctHalfUp);
    expect(a.legs.length).toBe(2);
    const host = a.legs.find((l) => l.recipientType === "host");
    const fee = a.legs.find((l) => l.recipientType === "platform_fee");
    expect(host?.settlementStrategy).toBe("operator_payout");
    expect(fee?.settlementStrategy).toBe("platform_fee_payout");
    expect(host?.shareBps).toBe(9000);
    expect(fee?.shareBps).toBe(1000);
  });
});
