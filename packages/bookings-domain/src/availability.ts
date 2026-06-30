import type {
  AvailabilityException,
  AvailabilityRule,
  BookingPolicy,
  BusyInterval,
  ResolveSlotsInput,
  ResolvedSlot,
} from "./types";
import { getLocalParts, localToUtc, parseIso, parseLocalTime, toIso } from "./time";
import { resolvePrice } from "./pricing";

const DAY_MS = 86400000;

interface Candidate {
  startUtc: string;
  endUtc: string;
  available: boolean;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Touching (aEnd === bStart or aStart === bEnd) is NOT an overlap.
  return aStart < bEnd && aEnd > bStart;
}

function generateFromRules(
  rules: AvailabilityRule[],
  windowStartMs: number,
  windowEndMs: number,
): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();

  for (const rule of rules) {
    const tz = rule.hostTimezone;
    const startMin = parseLocalTime(rule.startLocal);
    const endMin = parseLocalTime(rule.endLocal);
    const durSec = rule.slotDurationSeconds;
    const durMin = durSec / 60;
    const durMs = durSec * 1000;

    const effectiveFromMs = rule.effectiveFromUtc ? parseIso(rule.effectiveFromUtc) : -Infinity;
    const effectiveUntilMs = rule.effectiveUntilUtc ? parseIso(rule.effectiveUntilUtc) : Infinity;

    // Enumerate days in the window (±1 day for tz boundary safety).
    for (let t = windowStartMs - DAY_MS; t <= windowEndMs + DAY_MS; t += DAY_MS) {
      const parts = getLocalParts(t, tz);
      if (!rule.byWeekday.includes(parts.weekday)) continue;

      // Generate slot start times within this local day.
      for (let m = startMin; m + durMin <= endMin; m += durMin) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        const utcInstants = localToUtc(parts.year, parts.month, parts.day, h, min, tz);

        for (const startMs of utcInstants) {
          // Filter by window: start inclusive, end exclusive (a slot starting exactly
          // at windowEndMs belongs to the next window — important for API pagination).
          if (startMs < windowStartMs || startMs >= windowEndMs) continue;
          // Filter by effective range.
          if (startMs < effectiveFromMs || startMs > effectiveUntilMs) continue;

          const iso = toIso(startMs);
          if (!candidates.has(iso)) {
            candidates.set(iso, {
              startUtc: iso,
              endUtc: toIso(startMs + durMs),
              available: true,
            });
          }
        }
      }
    }
  }

  return candidates;
}

function applyOpenExceptions(
  candidates: Map<string, Candidate>,
  exceptions: AvailabilityException[],
  rules: AvailabilityRule[],
): void {
  const defaultDurSec = rules[0]?.slotDurationSeconds ?? 1800;
  const defaultDurMs = defaultDurSec * 1000;

  for (const exc of exceptions) {
    if (exc.kind !== "open") continue;
    const excStart = parseIso(exc.startUtc);
    const excEnd = parseIso(exc.endUtc);

    for (let t = excStart; t + defaultDurMs <= excEnd; t += defaultDurMs) {
      const iso = toIso(t);
      if (!candidates.has(iso)) {
        candidates.set(iso, {
          startUtc: iso,
          endUtc: toIso(t + defaultDurMs),
          available: true,
        });
      }
    }
  }
}

function applyBlockExceptions(
  candidates: Map<string, Candidate>,
  exceptions: AvailabilityException[],
): void {
  for (const exc of exceptions) {
    if (exc.kind !== "block") continue;
    const blockStart = parseIso(exc.startUtc);
    const blockEnd = parseIso(exc.endUtc);

    for (const slot of candidates.values()) {
      if (slot.available && overlaps(parseIso(slot.startUtc), parseIso(slot.endUtc), blockStart, blockEnd)) {
        slot.available = false;
      }
    }
  }
}

function applyBusy(
  candidates: Map<string, Candidate>,
  busy: BusyInterval[],
): void {
  for (const interval of busy) {
    const busyStart = parseIso(interval.startUtc);
    const busyEnd = parseIso(interval.endUtc);

    for (const slot of candidates.values()) {
      if (slot.available && overlaps(parseIso(slot.startUtc), parseIso(slot.endUtc), busyStart, busyEnd)) {
        slot.available = false;
      }
    }
  }
}

function applyLeadTimeAndMaxAdvance(
  candidates: Map<string, Candidate>,
  policy: BookingPolicy,
  nowMs: number,
): void {
  const minLeadMs = policy.minLeadTimeSeconds * 1000;
  const maxAdvanceMs = policy.maxAdvanceSeconds * 1000;

  for (const slot of candidates.values()) {
    const startMs = parseIso(slot.startUtc);
    if (startMs < nowMs + minLeadMs) {
      slot.available = false;
    }
    if (startMs > nowMs + maxAdvanceMs) {
      slot.available = false;
    }
  }
}

export function resolveSlots(input: ResolveSlotsInput): ResolvedSlot[] {
  const windowStartMs = parseIso(input.windowStartUtc);
  const windowEndMs = parseIso(input.windowEndUtc);
  const nowMs = parseIso(input.nowUtc);
  // Pricing time-of-day rules resolve against the explicit host timezone, NOT rules[0]
  // (which would silently misprice if rules ever carried differing timezones).
  const hostTz = input.hostTimezone;

  const candidates = generateFromRules(input.rules, windowStartMs, windowEndMs);
  applyOpenExceptions(candidates, input.exceptions, input.rules);
  applyBlockExceptions(candidates, input.exceptions);
  applyBusy(candidates, input.existingBusyUtc);
  applyLeadTimeAndMaxAdvance(candidates, input.policy, nowMs);

  const result = [...candidates.values()].map((c) => {
    const startMs = parseIso(c.startUtc);
    const endMs = parseIso(c.endUtc);
    const durationSeconds = Math.round((endMs - startMs) / 1000);
    return {
      startUtc: c.startUtc,
      endUtc: c.endUtc,
      priceCents: resolvePrice(
        { startUtc: c.startUtc, durationSeconds },
        input.priceRules,
        input.basePriceCents,
        hostTz,
      ),
      available: c.available,
    };
  });

  result.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return result;
}
