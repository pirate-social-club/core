// All money is integer minor units (cents) to avoid float drift.
export type Cents = number;
export type Bps = number; // basis points; 10_000 = 100%
export type IsoInstant = string; // RFC3339 UTC, e.g. "2026-06-22T14:00:00Z"
export type IanaTz = string; // e.g. "Europe/Vienna"

export type BookingState =
  | "hold" // slot reserved, not yet paid; has expiry
  | "quoted" // price + fee split bound to the hold
  | "pending_payment" // booker submitted a pay-in, awaiting receipt verification
  | "confirmed" // receipt verified; video session may be created
  | "live" // session in progress
  | "completed" // session finished; eligible for payout
  | "settled" // operator executed host payout
  | "expired_hold" // hold lapsed before payment
  | "cancelled_before_payment" // cancelled from pending_payment; funds never reached custody
  | "cancelled_by_host" // host cancelled after confirmation; full refund
  | "cancelled_by_booker" // booker cancelled after confirmation; window-based refund
  | "no_show_host"
  | "no_show_booker"
  | "refunded"
  | "disputed";

export type BookingEvent =
  | "QUOTE_BUILT"
  | "QUOTE_DROPPED"
  | "HOLD_EXPIRED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_FAILED"
  | "CANCEL"
  | "SESSION_STARTED"
  | "SESSION_ENDED"
  | "HOST_CANCELS"
  | "BOOKER_CANCELS"
  | "HOST_NO_SHOW"
  | "BOOKER_NO_SHOW"
  | "PAYOUT_EXECUTED"
  | "REFUND_EXECUTED"
  | "DISPUTE_OPENED"
  | "DISPUTE_RESOLVED_HOST"
  | "DISPUTE_RESOLVED_BOOKER";

export interface BookingTransition {
  from: BookingState;
  to: BookingState;
  event: BookingEvent;
}

export type Rounding = "half_up";

export interface RefundPolicy {
  bookerCancelAfterWindowRefundBps: Bps; // refund fraction if booker cancels past the free window
  noShowByBookerRefundBps: Bps; // refund fraction to booker when booker no-shows
  noShowByHostRefundBps: Bps; // refund fraction to booker when host no-shows
}

export interface BookingPolicy {
  platformFeeBps: Bps; // 1000 = 10%
  holdTtlSeconds: number; // e.g. 600
  minLeadTimeSeconds: number; // earliest a slot may start relative to now
  maxAdvanceSeconds: number; // furthest out a slot may be booked
  cancellationWindowSeconds: number; // free-cancel cutoff before start
  noShowGraceSeconds: number; // how long after start before no-show may be declared
  refundPolicy: RefundPolicy; // maps (state, who, when) -> refund amount
  rounding: Rounding; // fee rounding rule
}

export interface AvailabilityRule {
  hostTimezone: IanaTz;
  byWeekday: number[]; // 0=Sun..6=Sat, in host tz
  startLocal: string; // "09:00" in host tz
  endLocal: string; // "17:00" in host tz
  slotDurationSeconds: number;
  effectiveFromUtc?: IsoInstant;
  effectiveUntilUtc?: IsoInstant;
}

export interface AvailabilityException {
  kind: "block" | "open";
  startUtc: IsoInstant;
  endUtc: IsoInstant;
}

export interface PriceRule {
  // variable pricing: first matching rule (most specific) wins, else basePrice
  matchWeekday?: number[];
  matchLocalTimeRange?: { startLocal: string; endLocal: string };
  matchDurationSeconds?: number;
  priceCents: Cents;
}

export interface ResolvedSlot {
  startUtc: IsoInstant;
  endUtc: IsoInstant;
  priceCents: Cents; // resolved via PriceRule
  available: boolean; // false if blocked by exception/booking/hold/lead-time
}

export interface BookingAllocation {
  // snapshot used by settlement AND refund; mirrors purchase_allocation_legs shape
  legs: Array<{
    recipientType: "host" | "platform_fee";
    shareBps: Bps;
    amountCents: Cents;
    settlementStrategy: "operator_payout" | "platform_fee_payout";
  }>;
  // invariant: sum(shareBps) === 10_000 and sum(amountCents) === grossCents
}

export interface BookingQuotePreview {
  slot: ResolvedSlot;
  grossCents: Cents;
  platformFeeCents: Cents; // round(gross * platformFeeBps/10000)
  hostPayoutCents: Cents; // gross - platformFeeCents
  allocation: BookingAllocation; // the split snapshot
  expiresAtUtc: IsoInstant; // quote validity
}

export interface BusyInterval {
  startUtc: IsoInstant;
  endUtc: IsoInstant;
}

export interface ResolveSlotsInput {
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  existingBusyUtc: BusyInterval[]; // bookings + active holds
  windowStartUtc: IsoInstant;
  windowEndUtc: IsoInstant; // exclusive upper bound — a slot starting exactly at windowEndUtc is NOT included
  hostTimezone: IanaTz; // the host's timezone; pricing time-of-day rules resolve against this (not derived from rules[0])
  viewerTimezone: IanaTz;
  policy: BookingPolicy;
  nowUtc: IsoInstant;
  priceRules: PriceRule[]; // used to populate ResolvedSlot.priceCents via resolvePrice
  basePriceCents: Cents; // fallback when no priceRule matches
}

export interface ResolvePriceInput {
  startUtc: IsoInstant;
  durationSeconds: number;
}

export interface RefundResolution {
  refundCents: Cents;
  hostPayoutCents: Cents;
  platformFeeCents: Cents;
}

export interface ResolveRefundInput {
  state: BookingState;
  cancelledBy: "host" | "booker" | "system";
  slotStartUtc: IsoInstant;
  nowUtc: IsoInstant;
  policy: BookingPolicy;
  allocation: BookingAllocation;
}
