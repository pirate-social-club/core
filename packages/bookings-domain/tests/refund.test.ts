import { describe, expect, test } from "bun:test";
import { resolveRefund } from "../src/refund";
import { computeAllocation } from "../src/allocation";
import type { BookingAllocation, BookingPolicy, BookingState } from "../src/types";

const policy: BookingPolicy = {
  platformFeeBps: 1000,
  holdTtlSeconds: 600,
  minLeadTimeSeconds: 3600,
  maxAdvanceSeconds: 60 * 86400,
  cancellationWindowSeconds: 86400, // 24h free cancel
  noShowGraceSeconds: 600,
  refundPolicy: {
    bookerCancelAfterWindowRefundBps: 0, // no refund after window
    noShowByBookerRefundBps: 0, // booker no-show → no refund
    noShowByHostRefundBps: 10000, // host no-show → full refund
  },
  rounding: "half_up",
};

function allocation5000(): BookingAllocation {
  return computeAllocation(5000, policy); // fee=500, host=4500
}

describe("refund — cancelled_before_payment (no custody)", () => {
  test("zero refund, zero host, zero platform — funds never reached custody", () => {
    const result = resolveRefund({
      state: "cancelled_before_payment",
      cancelledBy: "booker",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-06-30T07:00:00Z",
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(0);
    expect(result.hostPayoutCents).toBe(0);
    expect(result.platformFeeCents).toBe(0);
  });
});

describe("refund — booker cancels before window cutoff → full refund", () => {
  test("full refund, zero platform fee (more than 24h before start)", () => {
    const result = resolveRefund({
      state: "cancelled_by_booker",
      cancelledBy: "booker",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-06-30T06:59:00Z", // 24h + 1min before start → before cutoff
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(5000);
    expect(result.hostPayoutCents).toBe(0);
    expect(result.platformFeeCents).toBe(0);
  });
});

describe("refund — booker cancels after window cutoff → policy-defined", () => {
  test("zero refund (policy bookerCancelAfterWindowRefundBps=0), host keeps payout", () => {
    const result = resolveRefund({
      state: "cancelled_by_booker",
      cancelledBy: "booker",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-06-30T07:01:00Z", // 23h59m before start → after cutoff
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(0);
    expect(result.hostPayoutCents).toBe(4500);
    expect(result.platformFeeCents).toBe(500);
  });

  test("partial refund (50% policy) splits remaining by original ratio", () => {
    const partialPolicy: BookingPolicy = {
      ...policy,
      refundPolicy: {
        ...policy.refundPolicy,
        bookerCancelAfterWindowRefundBps: 5000, // 50% refund after window
      },
    };
    const result = resolveRefund({
      state: "cancelled_by_booker",
      cancelledBy: "booker",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-06-30T07:01:00Z",
      policy: partialPolicy,
      allocation: computeAllocation(5000, partialPolicy),
    });
    expect(result.refundCents).toBe(2500); // 50% of 5000
    // remaining 2500 split by 90/10: fee=250, host=2250
    expect(result.platformFeeCents).toBe(250);
    expect(result.hostPayoutCents).toBe(2250);
    expect(result.refundCents + result.hostPayoutCents + result.platformFeeCents).toBe(5000);
  });
});

describe("refund — host cancels → full refund regardless of window", () => {
  test("full refund even after the cancellation window", () => {
    const result = resolveRefund({
      state: "cancelled_by_host",
      cancelledBy: "host",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-07-01T06:59:00Z", // 1 min before start — way after window
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(5000);
    expect(result.hostPayoutCents).toBe(0);
    expect(result.platformFeeCents).toBe(0);
  });
});

describe("refund — no-show by host → full refund to booker", () => {
  test("full refund (noShowByHostRefundBps=10000)", () => {
    const result = resolveRefund({
      state: "no_show_host",
      cancelledBy: "system",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-07-01T07:10:00Z",
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(5000);
    expect(result.hostPayoutCents).toBe(0);
    expect(result.platformFeeCents).toBe(0);
  });
});

describe("refund — no-show by booker → policy-defined", () => {
  test("zero refund (noShowByBookerRefundBps=0), host gets payout", () => {
    const result = resolveRefund({
      state: "no_show_booker",
      cancelledBy: "system",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-07-01T07:10:00Z",
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(0);
    expect(result.hostPayoutCents).toBe(4500);
    expect(result.platformFeeCents).toBe(500);
  });
});

describe("refund — completed → host payout, platform keeps fee", () => {
  test("zero refund, host gets original payout, platform keeps fee", () => {
    const result = resolveRefund({
      state: "completed",
      cancelledBy: "system",
      slotStartUtc: "2026-07-01T07:00:00Z",
      nowUtc: "2026-07-01T08:00:00Z",
      policy,
      allocation: allocation5000(),
    });
    expect(result.refundCents).toBe(0);
    expect(result.hostPayoutCents).toBe(4500);
    expect(result.platformFeeCents).toBe(500);
  });
});

describe("refund — invariant", () => {
  test("refund + host + platform === gross for all states with custody", () => {
    const states: BookingState[] = [
      "cancelled_by_booker",
      "cancelled_by_host",
      "no_show_host",
      "no_show_booker",
      "completed",
    ];
    for (const state of states) {
      const result = resolveRefund({
        state,
        cancelledBy: state === "cancelled_by_host" ? "host" : "system",
        slotStartUtc: "2026-07-01T07:00:00Z",
        nowUtc: "2026-06-30T06:00:00Z",
        policy,
        allocation: allocation5000(),
      });
      expect(result.refundCents + result.hostPayoutCents + result.platformFeeCents).toBe(5000);
    }
  });
});
