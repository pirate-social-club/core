// Test/fixtures subpath. Consumed by tests and by PR2 Storybook stories.
// Re-exports everything from the production entry plus fixture builders.
export * from "./index";

import type {
  AvailabilityException,
  AvailabilityRule,
  BookingAllocation,
  BookingPolicy,
  BookingQuotePreview,
  BookingState,
  PriceRule,
  ResolvedSlot,
} from "./index";
import { computeAllocation, buildQuotePreview } from "./index";

export const defaultBookingPolicy: BookingPolicy = {
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

export const viennaWeekdayRule: AvailabilityRule = {
  hostTimezone: "Europe/Vienna",
  byWeekday: [1, 2, 3, 4, 5],
  startLocal: "09:00",
  endLocal: "17:00",
  slotDurationSeconds: 1800,
};

export const viennaWeekendRule: AvailabilityRule = {
  hostTimezone: "Europe/Vienna",
  byWeekday: [0, 6],
  startLocal: "10:00",
  endLocal: "14:00",
  slotDurationSeconds: 1800,
};

export const noExceptions: AvailabilityException[] = [];

export const weekdayPremiumPricing: PriceRule[] = [
  {
    matchWeekday: [1, 2, 3, 4, 5],
    matchLocalTimeRange: { startLocal: "09:00", endLocal: "12:00" },
    priceCents: 6000,
  },
  {
    matchWeekday: [1, 2, 3, 4, 5],
    matchLocalTimeRange: { startLocal: "12:00", endLocal: "17:00" },
    priceCents: 5000,
  },
  {
    matchWeekday: [0, 6],
    priceCents: 7500,
  },
];

export const basePrice5000 = 5000;

export function makeResolvedSlot(opts: {
  startUtc: string;
  durationSeconds?: number;
  priceCents?: number;
  available?: boolean;
}): ResolvedSlot {
  const dur = opts.durationSeconds ?? 1800;
  const startMs = Date.parse(opts.startUtc);
  const endIso = new Date(startMs + dur * 1000).toISOString().replace(/\.000Z$/, "Z");
  return {
    startUtc: opts.startUtc,
    endUtc: endIso,
    priceCents: opts.priceCents ?? 5000,
    available: opts.available ?? true,
  };
}

export function makeAllocation(grossCents: number, policy = defaultBookingPolicy): BookingAllocation {
  return computeAllocation(grossCents, policy);
}

export function makeQuotePreview(opts: {
  startUtc: string;
  durationSeconds?: number;
  priceCents?: number;
  policy?: BookingPolicy;
  nowUtc?: string;
}): BookingQuotePreview {
  const policy = opts.policy ?? defaultBookingPolicy;
  const nowUtc = opts.nowUtc ?? "2026-06-22T12:00:00Z";
  const slot = makeResolvedSlot({
    startUtc: opts.startUtc,
    durationSeconds: opts.durationSeconds,
    priceCents: opts.priceCents ?? 5000,
  });
  return buildQuotePreview(slot, policy, nowUtc);
}

export const allBookingStates: BookingState[] = [
  "hold",
  "quoted",
  "pending_payment",
  "confirmed",
  "live",
  "completed",
  "settled",
  "expired_hold",
  "cancelled_before_payment",
  "cancelled_by_host",
  "cancelled_by_booker",
  "no_show_host",
  "no_show_booker",
  "refunded",
  "disputed",
];

export interface HostProfileFixture {
  name: string;
  bio: string;
  topics: string[];
  photoSrc: string;
  introVideoSrc?: string;
  basePriceCents: number;
}

export const sampleHostProfile: HostProfileFixture = {
  name: "Amira Hassan",
  bio: "Certified TEFL tutor with 8 years of experience teaching conversational English. I specialize in helping professionals build confidence in spoken English for work and travel.",
  topics: ["Conversational English", "Business English", "IELTS Prep"],
  photoSrc: "https://picsum.photos/seed/bookings-host-amira/160/160",
  basePriceCents: 5000,
};

export const sampleHostProfileNoVideo: HostProfileFixture = {
  ...sampleHostProfile,
  introVideoSrc: undefined,
};

export interface BookingListItemFixture {
  id: string;
  hostName: string;
  hostPhotoSrc: string;
  startUtc: string;
  endUtc: string;
  state: BookingState;
  priceCents: number;
}

export const upcomingBookings: BookingListItemFixture[] = [
  {
    id: "booking-1",
    hostName: "Amira Hassan",
    hostPhotoSrc: "https://picsum.photos/seed/bookings-host-amira/160/160",
    startUtc: "2026-07-01T07:00:00Z",
    endUtc: "2026-07-01T07:30:00Z",
    state: "confirmed",
    priceCents: 5000,
  },
  {
    id: "booking-2",
    hostName: "Marcus Chen",
    hostPhotoSrc: "https://picsum.photos/seed/bookings-host-marcus/160/160",
    startUtc: "2026-07-02T14:00:00Z",
    endUtc: "2026-07-02T15:00:00Z",
    state: "pending_payment",
    priceCents: 6000,
  },
];

export const pastBookings: BookingListItemFixture[] = [
  {
    id: "booking-3",
    hostName: "Amira Hassan",
    hostPhotoSrc: "https://picsum.photos/seed/bookings-host-amira/160/160",
    startUtc: "2026-06-15T07:00:00Z",
    endUtc: "2026-06-15T07:30:00Z",
    state: "settled",
    priceCents: 5000,
  },
  {
    id: "booking-4",
    hostName: "Sofia Rivera",
    hostPhotoSrc: "https://picsum.photos/seed/bookings-host-sofia/160/160",
    startUtc: "2026-06-10T16:00:00Z",
    endUtc: "2026-06-10T17:00:00Z",
    state: "completed",
    priceCents: 7500,
  },
];

export const cancelledBookings: BookingListItemFixture[] = [
  {
    id: "booking-5",
    hostName: "Marcus Chen",
    hostPhotoSrc: "https://picsum.photos/seed/bookings-host-marcus/160/160",
    startUtc: "2026-06-20T14:00:00Z",
    endUtc: "2026-06-20T15:00:00Z",
    state: "cancelled_by_booker",
    priceCents: 6000,
  },
];
