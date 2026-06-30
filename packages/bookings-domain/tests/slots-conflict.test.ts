import { describe, expect, test } from "bun:test";
import { resolveSlots } from "../src/availability";
import type { BookingPolicy } from "../src/types";

const basePolicy: BookingPolicy = {
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

function weekdayRule(weekday: number, startLocal: string, endLocal: string, dur = 1800) {
  return {
    hostTimezone: "Europe/Vienna",
    byWeekday: [weekday],
    startLocal,
    endLocal,
    slotDurationSeconds: dur,
  };
}

describe("slot conflict — overlapping an existing booking", () => {
  test("a slot overlapping an existing booking is available:false", () => {
    const slots = resolveSlots({
      rules: [weekdayRule(3, "09:00", "11:00")],
      exceptions: [],
      existingBusyUtc: [{ startUtc: "2026-07-01T07:30:00Z", endUtc: "2026-07-01T08:00:00Z" }],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    // 09:30 Vienna (07:30 UTC) overlaps the booking -> unavailable.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.available).toBe(false);
    // 09:00 (07:00 UTC) does not overlap -> available.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")?.available).toBe(true);
  });
});

describe("slot conflict — active vs expired hold", () => {
  test("a slot overlapping an active hold is unavailable; removing the busy interval frees it", () => {
    const hold = { startUtc: "2026-07-01T07:30:00Z", endUtc: "2026-07-01T08:00:00Z" };

    const withActiveHold = resolveSlots({
      rules: [weekdayRule(3, "09:00", "11:00")],
      exceptions: [],
      existingBusyUtc: [hold],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    expect(
      withActiveHold.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.available,
    ).toBe(false);

    // Caller drops the expired hold from existingBusyUtc -> slot is free again.
    const afterExpiry = resolveSlots({
      rules: [weekdayRule(3, "09:00", "11:00")],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    expect(
      afterExpiry.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.available,
    ).toBe(true);
  });
});

describe("slot conflict — adjacent (touching, non-overlapping) boundary", () => {
  test("two slots touching a busy interval on either side are both available", () => {
    // Rule 09:00-11:00 Vienna (CEST=UTC+2) → slot starts: 07:00, 07:30, 08:00, 08:30 UTC.
    // Busy [07:30, 08:00). The 07:00 UTC slot (09:00 Vienna) ends exactly at 07:30 = busy
    // start → touching, not overlapping → available. The 08:00 UTC slot (10:00 Vienna)
    // starts exactly at 08:00 = busy end → touching → available. The 07:30 UTC slot
    // overlaps → unavailable.
    const slots = resolveSlots({
      rules: [weekdayRule(3, "09:00", "11:00", 1800)],
      exceptions: [],
      existingBusyUtc: [{ startUtc: "2026-07-01T07:30:00Z", endUtc: "2026-07-01T08:00:00Z" }],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    // Lower touching: 09:00 Vienna (07:00 UTC) ends at 07:30 = busy start.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")?.available).toBe(true);
    // Overlapping: 09:30 Vienna (07:30 UTC) starts at busy start → unavailable.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.available).toBe(false);
    // Upper touching: 10:00 Vienna (08:00 UTC) starts at busy end.
    expect(slots.find((s) => s.startUtc === "2026-07-01T08:00:00Z")?.available).toBe(true);
  });
});
