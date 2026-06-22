import type { Cents, IanaTz, PriceRule, ResolvePriceInput } from "./types";
import { getLocalParts, parseIso } from "./time";

function ruleMatches(rule: PriceRule, weekday: number, localMinutes: number, durationSec: number): boolean {
  if (rule.matchWeekday !== undefined && !rule.matchWeekday.includes(weekday)) return false;
  if (rule.matchDurationSeconds !== undefined && rule.matchDurationSeconds !== durationSec) return false;
  if (rule.matchLocalTimeRange !== undefined) {
    const rangeStart = parseLocalTimeToMinutes(rule.matchLocalTimeRange.startLocal);
    const rangeEnd = parseLocalTimeToMinutes(rule.matchLocalTimeRange.endLocal);
    if (localMinutes < rangeStart || localMinutes >= rangeEnd) return false;
  }
  return true;
}

function parseLocalTimeToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function resolvePrice(
  slot: ResolvePriceInput,
  rules: PriceRule[],
  basePriceCents: Cents,
  hostTz: IanaTz,
): Cents {
  const startMs = parseIso(slot.startUtc);
  const parts = getLocalParts(startMs, hostTz);
  const localMinutes = parts.hour * 60 + parts.minute;

  for (const rule of rules) {
    if (ruleMatches(rule, parts.weekday, localMinutes, slot.durationSeconds)) {
      return rule.priceCents;
    }
  }

  return basePriceCents;
}
