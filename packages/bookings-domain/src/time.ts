import type { IanaTz, IsoInstant } from "./types";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface LocalDateParts {
  year: number;
  month: number; // 1-indexed (January = 1)
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
}

export function getLocalParts(utcMs: number, tz: IanaTz): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = parseInt(get("hour"), 10);
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
    weekday: WEEKDAY_SHORT[get("weekday")] ?? 0,
  };
}

export function getOffsetMs(utcMs: number, tz: IanaTz): number {
  const parts = getLocalParts(utcMs, tz);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - utcMs;
}

export function toIso(utcMs: number): IsoInstant {
  return new Date(utcMs).toISOString().replace(/\.000Z$/, "Z");
}

export function parseIso(iso: IsoInstant): number {
  return Date.parse(iso);
}

export function parseLocalTime(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

// Convert a local wall-clock time to UTC instant(s).
// Returns 0 results (spring-forward gap), 1 (normal), or 2 (fall-back repeated hour).
// Probes multiple offsets throughout the day to handle DST transitions correctly.
export function localToUtc(
  year: number,
  month: number, // 1-indexed
  day: number,
  hours: number,
  minutes: number,
  tz: IanaTz,
): number[] {
  const results = new Set<number>();
  const naiveUtc = Date.UTC(year, month - 1, day, hours, minutes, 0);

  // Probe the offset at several points spread across the day and neighbors.
  // On DST transition days, the offset changes, so different probes yield different candidates.
  for (const probeHour of [-2, 2, 6, 10, 14, 18, 22, 26]) {
    const probeMs = naiveUtc + probeHour * 3600000;
    const offset = getOffsetMs(probeMs, tz);
    const candidate = naiveUtc - offset;

    // Verify: does this candidate actually map back to the target local time?
    const parts = getLocalParts(candidate, tz);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hours &&
      parts.minute === minutes
    ) {
      results.add(candidate);
    }
  }

  return [...results].sort((a, b) => a - b);
}
