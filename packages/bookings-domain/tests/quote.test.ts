import { describe, expect, test } from "bun:test";
import { buildQuotePreview } from "../src/quote";
import type { BookingPolicy, ResolvedSlot } from "../src/types";

const policy: BookingPolicy = {
  platformFeeBps: 1000,
  holdTtlSeconds: 600, // 10 min hold
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

function slot(priceCents = 5000): ResolvedSlot {
  return {
    startUtc: "2026-07-01T07:00:00Z",
    endUtc: "2026-07-01T07:30:00Z",
    priceCents,
    available: true,
  };
}

describe("buildQuotePreview — basic", () => {
  test("binds price + fee split to a slot", () => {
    const quote = buildQuotePreview(slot(5000), policy, "2026-06-22T12:00:00Z");
    expect(quote.slot.startUtc).toBe("2026-07-01T07:00:00Z");
    expect(quote.grossCents).toBe(5000);
    expect(quote.platformFeeCents).toBe(500);
    expect(quote.hostPayoutCents).toBe(4500);
  });

  test("allocation legs sum to gross and 10000 bps", () => {
    const quote = buildQuotePreview(slot(5000), policy, "2026-06-22T12:00:00Z");
    const shareSum = quote.allocation.legs.reduce((acc, l) => acc + l.shareBps, 0);
    const amountSum = quote.allocation.legs.reduce((acc, l) => acc + l.amountCents, 0);
    expect(shareSum).toBe(10000);
    expect(amountSum).toBe(5000);
  });
});

describe("buildQuotePreview — expiry", () => {
  test("expiresAtUtc = nowUtc + holdTtlSeconds", () => {
    const quote = buildQuotePreview(slot(5000), policy, "2026-06-22T12:00:00Z");
    // 600 seconds = 10 minutes → 12:10:00Z
    expect(quote.expiresAtUtc).toBe("2026-06-22T12:10:00Z");
  });

  test("expiry respects different holdTtl", () => {
    const shortPolicy = { ...policy, holdTtlSeconds: 120 }; // 2 min
    const quote = buildQuotePreview(slot(5000), shortPolicy, "2026-06-22T12:00:00Z");
    expect(quote.expiresAtUtc).toBe("2026-06-22T12:02:00Z");
  });
});

describe("buildQuotePreview — odd amounts", () => {
  test("$33.33 → fee 333, host 3000", () => {
    const quote = buildQuotePreview(slot(3333), policy, "2026-06-22T12:00:00Z");
    expect(quote.grossCents).toBe(3333);
    expect(quote.platformFeeCents).toBe(333);
    expect(quote.hostPayoutCents).toBe(3000);
    expect(quote.platformFeeCents + quote.hostPayoutCents).toBe(quote.grossCents);
  });

  test("$0.01 → fee 0, host 1", () => {
    const quote = buildQuotePreview(slot(1), policy, "2026-06-22T12:00:00Z");
    expect(quote.platformFeeCents).toBe(0);
    expect(quote.hostPayoutCents).toBe(1);
  });
});
