import { describe, expect, test } from "bun:test";
import {
  MAX_AVAILABILITY_EXCEPTIONS_PER_HOST,
  MAX_AVAILABILITY_RULES_PER_HOST,
  MAX_PRICE_RULES_PER_HOST,
  validateAvailabilityExceptionInput,
  validateAvailabilityRuleInput,
  validateBps,
  validateBookingProfileInput,
  validateDurationSeconds,
  validateIanaTimezone,
  validateLocalTime,
  validatePriceRuleInput,
  validatePositiveCents,
  validateWeekdayArray,
} from "../src/validate";

describe("validateIanaTimezone", () => {
  test("accepts a valid IANA timezone", () => {
    expect(validateIanaTimezone("Europe/Vienna")).toBeNull();
    expect(validateIanaTimezone("America/New_York")).toBeNull();
    expect(validateIanaTimezone("Asia/Tokyo")).toBeNull();
    expect(validateIanaTimezone("UTC")).toBeNull();
  });

  test("rejects empty string", () => {
    const e = validateIanaTimezone("");
    expect(e).not.toBeNull();
    expect(e?.field).toBe("host_timezone");
    expect(e?.reason).toBe("required");
  });

  test("rejects invalid timezone", () => {
    const e = validateIanaTimezone("Fake/Zone");
    expect(e).not.toBeNull();
    expect(e?.reason).toBe("not_a_valid_iana_timezone");
  });

  test("rejects non-string", () => {
    const e = validateIanaTimezone(null as unknown as string);
    expect(e).not.toBeNull();
    expect(e?.reason).toBe("required");
  });
});

describe("validateLocalTime", () => {
  test("accepts valid 24-hour times", () => {
    expect(validateLocalTime("00:00")).toBeNull();
    expect(validateLocalTime("09:00")).toBeNull();
    expect(validateLocalTime("23:59")).toBeNull();
    expect(validateLocalTime("12:30")).toBeNull();
  });

  test("rejects bad formats", () => {
    expect(validateLocalTime("9:00")).not.toBeNull();
    expect(validateLocalTime("25:00")).not.toBeNull();
    expect(validateLocalTime("09:60")).not.toBeNull();
    expect(validateLocalTime("")).not.toBeNull();
    expect(validateLocalTime("09-00")).not.toBeNull();
    expect(validateLocalTime("09:00:00")).not.toBeNull();
  });

  test("uses custom field name", () => {
    const e = validateLocalTime("bad", "end_local");
    expect(e?.field).toBe("end_local");
  });
});

describe("validateWeekdayArray", () => {
  test("accepts valid weekday arrays", () => {
    expect(validateWeekdayArray([0])).toBeNull();
    expect(validateWeekdayArray([1, 2, 3, 4, 5])).toBeNull();
    expect(validateWeekdayArray([0, 6])).toBeNull();
  });

  test("rejects empty array", () => {
    const e = validateWeekdayArray([]);
    expect(e).not.toBeNull();
    expect(e?.reason).toBe("must be a non-empty array");
  });

  test("rejects out-of-range values", () => {
    expect(validateWeekdayArray([0, 7])?.reason).toBe(
      "must contain only integers 0-6 (Sun-Sat)",
    );
    expect(validateWeekdayArray([-1])?.reason).toBe(
      "must contain only integers 0-6 (Sun-Sat)",
    );
  });

  test("rejects duplicates", () => {
    expect(validateWeekdayArray([1, 1])?.reason).toBe(
      "must not contain duplicates",
    );
  });

  test("rejects non-integers", () => {
    expect(validateWeekdayArray([1.5])?.reason).toBe(
      "must contain only integers 0-6 (Sun-Sat)",
    );
  });
});

describe("validateDurationSeconds", () => {
  test("accepts positive integers", () => {
    expect(validateDurationSeconds(1800)).toBeNull();
    expect(validateDurationSeconds(1)).toBeNull();
    expect(validateDurationSeconds(86400)).toBeNull();
  });

  test("rejects zero and negative", () => {
    expect(validateDurationSeconds(0)?.reason).toBe(
      "must be a positive integer (seconds)",
    );
    expect(validateDurationSeconds(-1)?.reason).toBe(
      "must be a positive integer (seconds)",
    );
  });

  test("rejects non-integers", () => {
    expect(validateDurationSeconds(1.5)?.reason).toBe(
      "must be a positive integer (seconds)",
    );
  });
});

describe("validatePositiveCents", () => {
  test("accepts positive integers", () => {
    expect(validatePositiveCents(5000, "base_price_cents")).toBeNull();
    expect(validatePositiveCents(1, "price_cents")).toBeNull();
  });

  test("rejects zero and negative", () => {
    expect(validatePositiveCents(0, "price_cents")?.reason).toBe(
      "must be a positive integer (cents)",
    );
    expect(validatePositiveCents(-100, "price_cents")?.reason).toBe(
      "must be a positive integer (cents)",
    );
  });
});

describe("validateBps", () => {
  test("accepts valid bps range", () => {
    expect(validateBps(0)).toBeNull();
    expect(validateBps(1000)).toBeNull();
    expect(validateBps(10000)).toBeNull();
  });

  test("rejects out of range", () => {
    expect(validateBps(-1)?.reason).toBe(
      "must be an integer 0-10000 (basis points)",
    );
    expect(validateBps(10001)?.reason).toBe(
      "must be an integer 0-10000 (basis points)",
    );
  });
});

describe("validateBookingProfileInput", () => {
  test("returns no errors for valid full input", () => {
    expect(
      validateBookingProfileInput({
        host_timezone: "Europe/Vienna",
        base_price_cents: 5000,
        default_slot_duration_seconds: 1800,
        platform_fee_bps: 1000,
      }),
    ).toEqual([]);
  });

  test("returns no errors for empty partial input", () => {
    expect(validateBookingProfileInput({})).toEqual([]);
  });

  test("collects multiple errors", () => {
    const errors = validateBookingProfileInput({
      host_timezone: "Fake/Zone",
      base_price_cents: 0,
      default_slot_duration_seconds: -1,
      platform_fee_bps: 20000,
    });
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.field)).toEqual([
      "host_timezone",
      "base_price_cents",
      "default_slot_duration_seconds",
      "platform_fee_bps",
    ]);
  });

  test("validates individual fields when only some present", () => {
    const errors = validateBookingProfileInput({ base_price_cents: -5 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("base_price_cents");
  });

  test("validates nullable string profile fields", () => {
    expect(
      validateBookingProfileInput({
        display_headline: "Guitar lessons",
        bio: null,
        intro_video_ref: "intro-video-1",
      }),
    ).toEqual([]);

    const errors = validateBookingProfileInput({
      display_headline: 42,
      bio: false,
      intro_video_ref: {},
    } as never);
    expect(errors.map((e) => e.field)).toEqual([
      "display_headline",
      "bio",
      "intro_video_ref",
    ]);
  });

  test("validates topics as string array or null", () => {
    expect(validateBookingProfileInput({ topics: ["guitar", "theory"] })).toEqual([]);
    expect(validateBookingProfileInput({ topics: null })).toEqual([]);

    expect(
      validateBookingProfileInput({ topics: "guitar" as never }),
    ).toEqual([{ field: "topics", reason: "must be an array of strings or null" }]);
    expect(
      validateBookingProfileInput({ topics: ["guitar", 12] as never }),
    ).toEqual([{ field: "topics", reason: "must contain only strings" }]);
  });
});

describe("validateAvailabilityRuleInput", () => {
  test("returns no errors for valid input", () => {
    expect(
      validateAvailabilityRuleInput({
        by_weekday: [1, 2, 3, 4, 5],
        start_local: "09:00",
        end_local: "17:00",
        slot_duration_seconds: 1800,
      }),
    ).toEqual([]);
  });

  test("returns no errors with effective range", () => {
    expect(
      validateAvailabilityRuleInput({
        by_weekday: [1],
        start_local: "09:00",
        end_local: "17:00",
        slot_duration_seconds: 1800,
        effective_from_utc: "2026-01-01T00:00:00Z",
        effective_until_utc: "2026-12-31T23:59:59Z",
      }),
    ).toEqual([]);
  });

  test("rejects end_local <= start_local", () => {
    const errors = validateAvailabilityRuleInput({
      by_weekday: [1],
      start_local: "17:00",
      end_local: "09:00",
      slot_duration_seconds: 1800,
    });
    expect(errors.some((e) => e.field === "end_local" && e.reason === "must be after start_local")).toBe(true);
  });

  test("rejects equal start and end", () => {
    const errors = validateAvailabilityRuleInput({
      by_weekday: [1],
      start_local: "09:00",
      end_local: "09:00",
      slot_duration_seconds: 1800,
    });
    expect(errors.some((e) => e.field === "end_local")).toBe(true);
  });

  test("rejects effective_until <= effective_from", () => {
    const errors = validateAvailabilityRuleInput({
      by_weekday: [1],
      start_local: "09:00",
      end_local: "17:00",
      slot_duration_seconds: 1800,
      effective_from_utc: "2026-12-31T00:00:00Z",
      effective_until_utc: "2026-01-01T00:00:00Z",
    });
    expect(errors.some((e) => e.field === "effective_until_utc")).toBe(true);
  });

  test("collects errors from multiple fields", () => {
    const errors = validateAvailabilityRuleInput({
      by_weekday: [],
      start_local: "bad",
      end_local: "25:00",
      slot_duration_seconds: 0,
    });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("validateAvailabilityExceptionInput", () => {
  test("returns no errors for valid block", () => {
    expect(
      validateAvailabilityExceptionInput({
        kind: "block",
        start_utc: "2026-07-04T00:00:00Z",
        end_utc: "2026-07-04T23:59:59Z",
      }),
    ).toEqual([]);
  });

  test("returns no errors for valid open", () => {
    expect(
      validateAvailabilityExceptionInput({
        kind: "open",
        start_utc: "2026-07-04T10:00:00Z",
        end_utc: "2026-07-04T12:00:00Z",
      }),
    ).toEqual([]);
  });

  test("rejects invalid kind", () => {
    const errors = validateAvailabilityExceptionInput({
      kind: "closed" as "block" | "open",
      start_utc: "2026-07-04T00:00:00Z",
      end_utc: "2026-07-04T23:59:59Z",
    });
    expect(errors.some((e) => e.field === "kind")).toBe(true);
  });

  test("rejects end <= start", () => {
    const errors = validateAvailabilityExceptionInput({
      kind: "block",
      start_utc: "2026-07-04T12:00:00Z",
      end_utc: "2026-07-04T10:00:00Z",
    });
    expect(errors.some((e) => e.field === "end_utc" && e.reason === "must be after start_utc")).toBe(true);
  });

  test("rejects equal start and end", () => {
    const errors = validateAvailabilityExceptionInput({
      kind: "block",
      start_utc: "2026-07-04T10:00:00Z",
      end_utc: "2026-07-04T10:00:00Z",
    });
    expect(errors.some((e) => e.field === "end_utc")).toBe(true);
  });

  test("rejects bad ISO format", () => {
    const errors = validateAvailabilityExceptionInput({
      kind: "block",
      start_utc: "not-a-date",
      end_utc: "2026-07-04T10:00:00Z",
    });
    expect(errors.some((e) => e.field === "start_utc")).toBe(true);
  });
});

describe("validatePriceRuleInput", () => {
  test("returns no errors for wildcard (only price_cents)", () => {
    expect(validatePriceRuleInput({ price_cents: 6000 })).toEqual([]);
  });

  test("returns no errors for full matchers", () => {
    expect(
      validatePriceRuleInput({
        match_weekday: [1, 2, 3],
        match_local_start: "18:00",
        match_local_end: "20:00",
        match_duration_seconds: 1800,
        price_cents: 8000,
      }),
    ).toEqual([]);
  });

  test("rejects zero price", () => {
    const errors = validatePriceRuleInput({ price_cents: 0 });
    expect(errors.some((e) => e.field === "price_cents")).toBe(true);
  });

  test("rejects negative price", () => {
    const errors = validatePriceRuleInput({ price_cents: -1 });
    expect(errors.some((e) => e.field === "price_cents")).toBe(true);
  });

  test("rejects invalid weekday in matcher", () => {
    const errors = validatePriceRuleInput({
      match_weekday: [8],
      price_cents: 6000,
    });
    expect(errors.some((e) => e.field === "match_weekday")).toBe(true);
  });

  test("rejects match_local_end <= match_local_start", () => {
    const errors = validatePriceRuleInput({
      match_local_start: "20:00",
      match_local_end: "18:00",
      price_cents: 6000,
    });
    expect(errors.some((e) => e.field === "match_local_end")).toBe(true);
  });

  test("rejects invalid match_duration", () => {
    const errors = validatePriceRuleInput({
      match_duration_seconds: 0,
      price_cents: 6000,
    });
    expect(errors.some((e) => e.field === "match_duration_seconds")).toBe(true);
  });

  test("does not include priority field (service-layer concern)", () => {
    const input: { price_cents: number } = { price_cents: 5000 };
    expect(validatePriceRuleInput(input)).toEqual([]);
  });
});

describe("bounds constants", () => {
  test("MAX_AVAILABILITY_RULES_PER_HOST is 50", () => {
    expect(MAX_AVAILABILITY_RULES_PER_HOST).toBe(50);
  });
  test("MAX_AVAILABILITY_EXCEPTIONS_PER_HOST is 200", () => {
    expect(MAX_AVAILABILITY_EXCEPTIONS_PER_HOST).toBe(200);
  });
  test("MAX_PRICE_RULES_PER_HOST is 50", () => {
    expect(MAX_PRICE_RULES_PER_HOST).toBe(50);
  });
});
