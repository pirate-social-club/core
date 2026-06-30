import { describe, expect, test } from "bun:test";
import { resolveSlots } from "../src/availability";
import type { BookingPolicy, PriceRule } from "../src/types";

const policy: BookingPolicy = {
  platformFeeBps: 1000,
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

describe("resolveSlots price population", () => {
  test("slot.priceCents is populated via resolvePrice (base price when no rules)", () => {
    const slots = resolveSlots({
      rules: [
        {
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "10:00",
          slotDurationSeconds: 1800,
        },
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    expect(slots.length).toBe(2);
    for (const s of slots) {
      expect(s.priceCents).toBe(5000);
    }
  });

  test("slot.priceCents reflects variable pricing rules", () => {
    const priceRules: PriceRule[] = [
      {
        matchLocalTimeRange: { startLocal: "09:00", endLocal: "09:30" },
        priceCents: 6000, // premium for first 30-min slot
      },
    ];
    const slots = resolveSlots({
      rules: [
        {
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "10:00",
          slotDurationSeconds: 1800,
        },
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules,
      basePriceCents: 5000,
    });
    // 09:00 Vienna (07:00 UTC) matches the premium rule → 6000
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")?.priceCents).toBe(6000);
    // 09:30 Vienna (07:30 UTC) doesn't match → base price 5000
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.priceCents).toBe(5000);
  });

  test("pricing time-of-day rules resolve against the EXPLICIT input.hostTimezone, not rules[0]", () => {
    // Deliberately mismatch the rule timezone (Vienna) from the pricing host timezone (Tokyo)
    // to prove which one drives time-of-day pricing. The slot is GENERATED in Vienna
    // (09:00 Vienna = 07:00 UTC), but PRICED against input.hostTimezone.
    //   07:00 UTC = 09:00 Europe/Vienna  (old rules[0] behavior → would NOT match)
    //   07:00 UTC = 16:00 Asia/Tokyo     (explicit hostTimezone → matches the premium window)
    const priceRules: PriceRule[] = [
      { matchLocalTimeRange: { startLocal: "16:00", endLocal: "16:30" }, priceCents: 9000 },
    ];
    const slots = resolveSlots({
      rules: [
        {
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "09:30",
          slotDurationSeconds: 1800,
        },
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Asia/Tokyo",
      viewerTimezone: "Europe/Vienna",
      policy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules,
      basePriceCents: 5000,
    });
    // If pricing used rules[0] (Vienna), 07:00 UTC = 09:00 → base 5000.
    // Because it uses the explicit hostTimezone (Tokyo), 07:00 UTC = 16:00 → premium 9000.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")?.priceCents).toBe(9000);
  });
});
