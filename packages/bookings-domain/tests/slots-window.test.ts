import { describe, expect, test } from "bun:test";
import { resolveSlots } from "../src/availability";
import type { BookingPolicy } from "../src/types";

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

describe("slot window boundaries — start inclusive, end exclusive", () => {
  // Rule 09:00–11:00 Vienna (CEST = UTC+2) → slot starts 07:00, 07:30, 08:00, 08:30 UTC.
  // Window [07:00, 08:00): start inclusive keeps 07:00; end exclusive drops 08:00.
  const baseInput = {
    rules: [
      {
        hostTimezone: "Europe/Vienna",
        byWeekday: [3], // Wednesday 2026-07-01
        startLocal: "09:00",
        endLocal: "11:00",
        slotDurationSeconds: 1800,
      },
    ],
    exceptions: [],
    existingBusyUtc: [],
    windowStartUtc: "2026-07-01T07:00:00Z",
    windowEndUtc: "2026-07-01T08:00:00Z",
    hostTimezone: "Europe/Vienna",
    viewerTimezone: "Europe/Vienna",
    policy,
    nowUtc: "2026-06-22T00:00:00Z",
    priceRules: [],
    basePriceCents: 5000,
  };

  test("a slot starting exactly at windowStartUtc IS included (start inclusive)", () => {
    const slots = resolveSlots(baseInput);
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")).toBeDefined();
  });

  test("a slot starting exactly at windowEndUtc is NOT included (end exclusive)", () => {
    const slots = resolveSlots(baseInput);
    expect(slots.find((s) => s.startUtc === "2026-07-01T08:00:00Z")).toBeUndefined();
  });

  test("only the in-window slots remain: 07:00 and 07:30", () => {
    const slots = resolveSlots(baseInput);
    expect(slots.map((s) => s.startUtc).sort()).toEqual([
      "2026-07-01T07:00:00Z",
      "2026-07-01T07:30:00Z",
    ]);
  });
});
