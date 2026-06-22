import { describe, expect, test } from "bun:test";
import { resolveSlots } from "../src/availability";
import type { BookingPolicy, IanaTz } from "../src/types";

const basePolicy: BookingPolicy = {
  platformFeeBps: 1000,
  holdTtlSeconds: 600,
  minLeadTimeSeconds: 3600, // 1h
  maxAdvanceSeconds: 60 * 86400, // 60 days
  cancellationWindowSeconds: 86400, // 24h
  noShowGraceSeconds: 600,
  refundPolicy: {
    bookerCancelAfterWindowRefundBps: 0,
    noShowByBookerRefundBps: 0,
    noShowByHostRefundBps: 10000,
  },
  rounding: "half_up",
};

function rule(opts: {
  hostTimezone: IanaTz;
  byWeekday: number[];
  startLocal: string;
  endLocal: string;
  slotDurationSeconds: number;
}) {
  return {
    hostTimezone: opts.hostTimezone,
    byWeekday: opts.byWeekday,
    startLocal: opts.startLocal,
    endLocal: opts.endLocal,
    slotDurationSeconds: opts.slotDurationSeconds,
  };
}

describe("slot generation — timezone conversion", () => {
  test("slots generated in host tz are presented correctly in a different viewer tz", () => {
    // Host in Vienna (UTC+2 in summer), viewer in New York (UTC-4 in summer).
    // A 09:00 Vienna slot on 2026-07-01 is 07:00 UTC = 03:00 New York EDT.
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [3], // Wednesday 2026-07-01
          startLocal: "09:00",
          endLocal: "10:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "America/New_York",
      policy: basePolicy,
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    expect(slots.length).toBe(2); // 09:00 and 09:30 Vienna
    expect(slots[0].startUtc).toBe("2026-07-01T07:00:00Z"); // 09:00 CEST = 07:00 UTC
    expect(slots[1].startUtc).toBe("2026-07-01T07:30:00Z");
    expect(slots.every((s) => s.available)).toBe(true);
  });
});

describe("slot generation — DST spring-forward (skipped hour)", () => {
  test("a 02:30 local slot that doesn't exist is dropped, no duplicates (Europe/Vienna 2026-03-29)", () => {
    // Vienna springs forward 02:00 -> 03:00 on 2026-03-29 (last Sunday of March).
    // A rule producing 30-min slots from 01:30 would attempt 02:00 and 02:30 — both skipped.
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [0], // Sunday 2026-03-29
          startLocal: "01:30",
          endLocal: "04:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-03-28T23:00:00Z",
      windowEndUtc: "2026-03-29T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-03-20T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    // Expected local slots: 01:30 (valid), [02:00 dropped], [02:30 dropped], 03:00, 03:30.
    // No slot may start in the skipped 02:00-03:00 local wall-clock window; no duplicates.
    expect(slots.length).toBe(3); // 01:30 CET, 03:00 CEST, 03:30 CEST
    const fmt = (utc: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Vienna",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(utc));
    for (const s of slots) {
      // No slot's Vienna local time falls in the skipped 02:xx hour.
      expect(fmt(s.startUtc).startsWith("02")).toBe(false);
    }
    const starts = slots.map((s) => s.startUtc);
    expect(new Set(starts).size).toBe(starts.length); // no dupes
  });
});

describe("slot generation — DST fall-back (repeated hour)", () => {
  test("the repeated local hour produces both distinct UTC instants, no dupes (Europe/Vienna 2026-10-25)", () => {
    // Vienna falls back 03:00 CEST -> 02:00 CET on 2026-10-25 (last Sunday of October).
    // Local 02:00 and 02:30 each occur at TWO distinct UTC instants — one in CEST, one in CET.
    // Decision: emit BOTH. They are real, non-overlapping instants. The UI must disambiguate
    // by showing the offset (e.g. "02:30 CEST" vs "02:30 CET") so the booker knows which one.
    //
    // Expected 7 slots (local start times 01:30, 02:00, 02:30, 03:00, 03:30):
    //   01:30 CEST = 23:30 Oct 24 UTC
    //   02:00 CEST = 00:00 Oct 25 UTC  (first occurrence)
    //   02:30 CEST = 00:30 Oct 25 UTC  (first occurrence)
    //   02:00 CET  = 01:00 Oct 25 UTC  (repeated hour, second occurrence)
    //   02:30 CET  = 01:30 Oct 25 UTC  (repeated hour, second occurrence)
    //   03:00 CET  = 02:00 Oct 25 UTC
    //   03:30 CET  = 02:30 Oct 25 UTC
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [0], // Sunday 2026-10-25
          startLocal: "01:30",
          endLocal: "04:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-10-24T23:00:00Z",
      windowEndUtc: "2026-10-25T23:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-10-15T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    const starts = slots.map((s) => s.startUtc);
    expect(new Set(starts).size).toBe(starts.length); // no duplicate UTC instants
    expect(slots.length).toBe(7); // emit both occurrences of the repeated hour
    // Verify the two repeated-hour instants are both present.
    expect(starts).toContain("2026-10-25T00:00:00Z"); // 02:00 CEST
    expect(starts).toContain("2026-10-25T01:00:00Z"); // 02:00 CET
  });
});

describe("slot generation — lead time and max advance", () => {
  test("minLeadTime removes too-soon slots", () => {
    // nowUtc is 2026-07-01T06:50:00Z; first slot at 07:00 is only 10 min away (< 1h lead).
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "11:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-30T22:00:00Z",
      windowEndUtc: "2026-07-01T22:00:00Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: basePolicy,
      nowUtc: "2026-07-01T06:50:00Z", // 10 min before 09:00 Vienna (07:00 UTC)
      priceRules: [],
      basePriceCents: 5000,
    });
    const first = slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z");
    expect(first?.available).toBe(false); // only 10 min lead < 3600
    const later = slots.find((s) => s.startUtc === "2026-07-01T07:30:00Z");
    expect(later?.available).toBe(false); // 40 min lead < 3600
    const ok = slots.find((s) => s.startUtc === "2026-07-01T08:00:00Z");
    expect(ok?.available).toBe(true); // 70 min lead >= 3600
  });

  test("maxAdvance removes too-far slots", () => {
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "10:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [],
      existingBusyUtc: [],
      windowStartUtc: "2026-06-22T00:00:00Z",
      windowEndUtc: "2026-12-31T23:59:59Z",
      hostTimezone: "Europe/Vienna",
      viewerTimezone: "Europe/Vienna",
      policy: { ...basePolicy, maxAdvanceSeconds: 7 * 86400 }, // 7 days
      nowUtc: "2026-06-22T00:00:00Z",
      priceRules: [],
      basePriceCents: 5000,
    });
    // Anything beyond 7 days from now must be unavailable.
    for (const s of slots) {
      const startMs = Date.parse(s.startUtc);
      const nowMs = Date.parse("2026-06-22T00:00:00Z");
      if (startMs - nowMs > 7 * 86400 * 1000) {
        expect(s.available).toBe(false);
      }
    }
  });
});

describe("slot generation — exceptions", () => {
  test("exception:block removes overlapping slots", () => {
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "09:00",
          endLocal: "11:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [
        { kind: "block", startUtc: "2026-07-01T07:30:00Z", endUtc: "2026-07-01T08:30:00Z" },
      ],
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
    // 09:30 Vienna (07:30 UTC) and 10:00 Vienna (08:00 UTC) overlap the block -> unavailable.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:30:00Z")?.available).toBe(false);
    expect(slots.find((s) => s.startUtc === "2026-07-01T08:00:00Z")?.available).toBe(false);
    // 09:00 and 10:30 are outside the block -> available.
    expect(slots.find((s) => s.startUtc === "2026-07-01T07:00:00Z")?.available).toBe(true);
    expect(slots.find((s) => s.startUtc === "2026-07-01T08:30:00Z")?.available).toBe(true);
  });

  test("exception:open adds an outside-rule slot", () => {
    const slots = resolveSlots({
      rules: [
        rule({
          hostTimezone: "Europe/Vienna",
          byWeekday: [3],
          startLocal: "10:00",
          endLocal: "11:00",
          slotDurationSeconds: 1800,
        }),
      ],
      exceptions: [
        { kind: "open", startUtc: "2026-07-01T05:00:00Z", endUtc: "2026-07-01T06:00:00Z" },
      ],
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
    // The open window 05:00-06:00 UTC adds slots not in the 10:00-11:00 rule.
    expect(slots.find((s) => s.startUtc === "2026-07-01T05:00:00Z")?.available).toBe(true);
    expect(slots.find((s) => s.startUtc === "2026-07-01T05:30:00Z")?.available).toBe(true);
  });
});
