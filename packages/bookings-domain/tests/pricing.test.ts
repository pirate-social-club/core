import { describe, expect, test } from "bun:test";
import { resolvePrice } from "../src/pricing";
import type { PriceRule } from "../src/types";

describe("pricing — base price when no rule matches", () => {
  test("returns base price when rules array is empty", () => {
    const price = resolvePrice(
      { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
      [],
      5000,
      "Europe/Vienna",
    );
    expect(price).toBe(5000);
  });

  test("returns base price when no rule matches the slot", () => {
    const rules: PriceRule[] = [
      { matchWeekday: [1], priceCents: 6000 }, // Monday only, slot is Wednesday
    ];
    const price = resolvePrice(
      { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 }, // Wed 09:00 Vienna
      rules,
      5000,
      "Europe/Vienna",
    );
    expect(price).toBe(5000);
  });
});

describe("pricing — first matching rule wins", () => {
  test("the first matching rule in the array wins, not the most specific", () => {
    const rules: PriceRule[] = [
      { matchWeekday: [3], priceCents: 6000 }, // Wednesday, broad
      { matchWeekday: [3], matchLocalTimeRange: { startLocal: "09:00", endLocal: "10:00" }, priceCents: 7000 }, // Wednesday 09:00, specific
    ];
    const price = resolvePrice(
      { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 }, // Wed 09:00 Vienna
      rules,
      5000,
      "Europe/Vienna",
    );
    // First matching rule wins (callers sort by specificity before calling).
    expect(price).toBe(6000);
  });

  test("a later rule matches if an earlier one doesn't", () => {
    const rules: PriceRule[] = [
      { matchWeekday: [1], priceCents: 6000 }, // Monday — doesn't match
      { matchWeekday: [3], priceCents: 7000 }, // Wednesday — matches
    ];
    const price = resolvePrice(
      { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 }, // Wed
      rules,
      5000,
      "Europe/Vienna",
    );
    expect(price).toBe(7000);
  });
});

describe("pricing — duration-based pricing", () => {
  test("matches a specific duration", () => {
    const rules: PriceRule[] = [
      { matchDurationSeconds: 3600, priceCents: 8000 }, // 60-min slot
    ];
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 3600 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(8000);
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(5000); // 30-min doesn't match, base price
  });
});

describe("pricing — time-of-day pricing across tz", () => {
  test("matches a local time range in the host timezone", () => {
    const rules: PriceRule[] = [
      { matchLocalTimeRange: { startLocal: "09:00", endLocal: "12:00" }, priceCents: 6000 }, // morning premium
    ];
    // 07:00 UTC = 09:00 Vienna (CEST) — in range.
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(6000);
    // 10:00 UTC = 12:00 Vienna — end of range (exclusive) — doesn't match.
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T10:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(5000);
  });

  test("time-of-day matching is timezone-correct (same UTC, different host tz)", () => {
    const rules: PriceRule[] = [
      { matchLocalTimeRange: { startLocal: "09:00", endLocal: "12:00" }, priceCents: 6000 },
    ];
    // 07:00 UTC = 09:00 Vienna (CEST) — in range → 6000
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(6000);
    // 07:00 UTC = 03:00 New York (EDT, UTC-4) — not in range → base price
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "America/New_York",
      ),
    ).toBe(5000);
  });
});

describe("pricing — combined weekday + time-of-day", () => {
  test("matches only when both conditions are satisfied", () => {
    const rules: PriceRule[] = [
      { matchWeekday: [3], matchLocalTimeRange: { startLocal: "09:00", endLocal: "10:00" }, priceCents: 7500 },
    ];
    // Wed 09:00 Vienna — both match.
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(7500);
    // Wed 09:30 Vienna (07:30 UTC) — weekday matches, time 09:30 is in [09:00, 10:00) → matches.
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T07:30:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(7500);
    // Wed 10:00 Vienna (08:00 UTC) — time 10:00 is end (exclusive) → doesn't match.
    expect(
      resolvePrice(
        { startUtc: "2026-07-01T08:00:00Z", durationSeconds: 1800 },
        rules,
        5000,
        "Europe/Vienna",
      ),
    ).toBe(5000);
  });
});
