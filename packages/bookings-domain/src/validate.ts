import { parseIso } from "./time";

export interface ValidationError {
  field: string;
  reason: string;
}

export const MAX_AVAILABILITY_RULES_PER_HOST = 50;
export const MAX_AVAILABILITY_EXCEPTIONS_PER_HOST = 200;
export const MAX_PRICE_RULES_PER_HOST = 50;

const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

let knownTimezones: Set<string> | null = null;

function getKnownTimezones(): Set<string> {
  if (knownTimezones) return knownTimezones;
  try {
    const list = Intl.supportedValuesOf("timeZone") as readonly string[];
    knownTimezones = new Set(list);
  } catch {
    knownTimezones = new Set();
  }
  return knownTimezones;
}

export function validateIanaTimezone(
  tz: string,
  field = "host_timezone",
): ValidationError | null {
  if (typeof tz !== "string" || tz.length === 0) {
    return { field, reason: "required" };
  }
  const known = getKnownTimezones();
  if (known.size > 0) {
    if (!known.has(tz)) {
      return { field, reason: "not_a_valid_iana_timezone" };
    }
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { field, reason: "not_a_valid_iana_timezone" };
  }
  return null;
}

export function validateLocalTime(
  s: string,
  field = "start_local",
): ValidationError | null {
  if (typeof s !== "string" || !LOCAL_TIME_RE.test(s)) {
    return { field, reason: "must be HH:MM in 24-hour format" };
  }
  return null;
}

export function validateWeekdayArray(
  a: number[],
  field = "by_weekday",
): ValidationError | null {
  if (!Array.isArray(a) || a.length === 0) {
    return { field, reason: "must be a non-empty array" };
  }
  for (const d of a) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
      return { field, reason: "must contain only integers 0-6 (Sun-Sat)" };
    }
  }
  if (new Set(a).size !== a.length) {
    return { field, reason: "must not contain duplicates" };
  }
  return null;
}

export function validateDurationSeconds(
  n: number,
  field = "slot_duration_seconds",
): ValidationError | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return { field, reason: "must be a positive integer (seconds)" };
  }
  return null;
}

export function validatePositiveCents(
  n: number,
  field: string,
): ValidationError | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return { field, reason: "must be a positive integer (cents)" };
  }
  return null;
}

export function validateBps(
  n: number,
  field = "platform_fee_bps",
): ValidationError | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10000) {
    return { field, reason: "must be an integer 0-10000 (basis points)" };
  }
  return null;
}

function validateNullableString(
  value: string | null,
  field: string,
): ValidationError | null {
  if (value !== null && typeof value !== "string") {
    return { field, reason: "must be a string or null" };
  }
  return null;
}

function validateTopics(
  topics: string[] | null,
): ValidationError | null {
  if (topics === null) return null;
  if (!Array.isArray(topics)) {
    return { field: "topics", reason: "must be an array of strings or null" };
  }
  if (topics.some((topic) => typeof topic !== "string")) {
    return { field: "topics", reason: "must contain only strings" };
  }
  return null;
}

function validateIsoInstant(
  s: string,
  field: string,
): ValidationError | null {
  if (typeof s !== "string" || !ISO_INSTANT_RE.test(s)) {
    return { field, reason: "must be an RFC3339 UTC instant (e.g. 2026-07-04T00:00:00Z)" };
  }
  if (Number.isNaN(parseIso(s))) {
    return { field, reason: "must be a valid date-time" };
  }
  return null;
}

export interface BookingProfileInput {
  host_timezone?: string;
  base_price_cents?: number;
  default_slot_duration_seconds?: number;
  display_headline?: string | null;
  bio?: string | null;
  topics?: string[] | null;
  intro_video_ref?: string | null;
  platform_fee_bps?: number;
}

export function validateBookingProfileInput(
  input: BookingProfileInput,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.host_timezone !== undefined) {
    const e = validateIanaTimezone(input.host_timezone);
    if (e) errors.push(e);
  }
  if (input.base_price_cents !== undefined) {
    const e = validatePositiveCents(input.base_price_cents, "base_price_cents");
    if (e) errors.push(e);
  }
  if (input.default_slot_duration_seconds !== undefined) {
    const e = validateDurationSeconds(
      input.default_slot_duration_seconds,
      "default_slot_duration_seconds",
    );
    if (e) errors.push(e);
  }
  if (input.platform_fee_bps !== undefined) {
    const e = validateBps(input.platform_fee_bps);
    if (e) errors.push(e);
  }
  if (input.display_headline !== undefined) {
    const e = validateNullableString(input.display_headline, "display_headline");
    if (e) errors.push(e);
  }
  if (input.bio !== undefined) {
    const e = validateNullableString(input.bio, "bio");
    if (e) errors.push(e);
  }
  if (input.intro_video_ref !== undefined) {
    const e = validateNullableString(input.intro_video_ref, "intro_video_ref");
    if (e) errors.push(e);
  }
  if (input.topics !== undefined) {
    const e = validateTopics(input.topics);
    if (e) errors.push(e);
  }
  return errors;
}

export interface AvailabilityRuleInput {
  by_weekday: number[];
  start_local: string;
  end_local: string;
  slot_duration_seconds: number;
  effective_from_utc?: string;
  effective_until_utc?: string;
}

export function validateAvailabilityRuleInput(
  input: AvailabilityRuleInput,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const wd = validateWeekdayArray(input.by_weekday);
  if (wd) errors.push(wd);
  const start = validateLocalTime(input.start_local, "start_local");
  if (start) errors.push(start);
  const end = validateLocalTime(input.end_local, "end_local");
  if (end) errors.push(end);
  const dur = validateDurationSeconds(input.slot_duration_seconds);
  if (dur) errors.push(dur);
  if (input.effective_from_utc !== undefined) {
    const e = validateIsoInstant(input.effective_from_utc, "effective_from_utc");
    if (e) errors.push(e);
  }
  if (input.effective_until_utc !== undefined) {
    const e = validateIsoInstant(input.effective_until_utc, "effective_until_utc");
    if (e) errors.push(e);
  }
  if (
    input.effective_from_utc !== undefined
    && input.effective_until_utc !== undefined
    && !Number.isNaN(parseIso(input.effective_from_utc))
    && !Number.isNaN(parseIso(input.effective_until_utc))
    && parseIso(input.effective_from_utc) >= parseIso(input.effective_until_utc)
  ) {
    errors.push({
      field: "effective_until_utc",
      reason: "must be after effective_from_utc",
    });
  }
  if (
    !start
    && !end
    && parseIso(`2000-01-01T${input.start_local}:00Z`)
      >= parseIso(`2000-01-01T${input.end_local}:00Z`)
  ) {
    errors.push({
      field: "end_local",
      reason: "must be after start_local",
    });
  }
  return errors;
}

export interface AvailabilityExceptionInput {
  kind: "block" | "open";
  start_utc: string;
  end_utc: string;
}

export function validateAvailabilityExceptionInput(
  input: AvailabilityExceptionInput,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.kind !== "block" && input.kind !== "open") {
    errors.push({ field: "kind", reason: "must be 'block' or 'open'" });
  }
  const start = validateIsoInstant(input.start_utc, "start_utc");
  if (start) errors.push(start);
  const end = validateIsoInstant(input.end_utc, "end_utc");
  if (end) errors.push(end);
  if (
    !start
    && !end
    && parseIso(input.start_utc) >= parseIso(input.end_utc)
  ) {
    errors.push({
      field: "end_utc",
      reason: "must be after start_utc",
    });
  }
  return errors;
}

export interface PriceRuleInput {
  match_weekday?: number[];
  match_local_start?: string;
  match_local_end?: string;
  match_duration_seconds?: number;
  price_cents: number;
}

export function validatePriceRuleInput(
  input: PriceRuleInput,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.match_weekday !== undefined) {
    const e = validateWeekdayArray(input.match_weekday, "match_weekday");
    if (e) errors.push(e);
  }
  if (input.match_local_start !== undefined) {
    const e = validateLocalTime(input.match_local_start, "match_local_start");
    if (e) errors.push(e);
  }
  if (input.match_local_end !== undefined) {
    const e = validateLocalTime(input.match_local_end, "match_local_end");
    if (e) errors.push(e);
  }
  if (
    input.match_local_start !== undefined
    && input.match_local_end !== undefined
    && !validateLocalTime(input.match_local_start)
    && !validateLocalTime(input.match_local_end)
    && parseIso(`2000-01-01T${input.match_local_start}:00Z`)
      >= parseIso(`2000-01-01T${input.match_local_end}:00Z`)
  ) {
    errors.push({
      field: "match_local_end",
      reason: "must be after match_local_start",
    });
  }
  if (input.match_duration_seconds !== undefined) {
    const e = validateDurationSeconds(
      input.match_duration_seconds,
      "match_duration_seconds",
    );
    if (e) errors.push(e);
  }
  const price = validatePositiveCents(input.price_cents, "price_cents");
  if (price) errors.push(price);
  return errors;
}
