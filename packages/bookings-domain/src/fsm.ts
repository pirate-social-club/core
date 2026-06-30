import type { BookingEvent, BookingState } from "./types";

const TRANSITIONS = new Map<string, BookingState>();

const ALLOWED: Array<[BookingState, BookingEvent, BookingState]> = [
  ["hold", "QUOTE_BUILT", "quoted"],
  ["hold", "HOLD_EXPIRED", "expired_hold"],
  ["quoted", "QUOTE_DROPPED", "hold"],
  ["quoted", "PAYMENT_SUBMITTED", "pending_payment"],
  ["quoted", "HOLD_EXPIRED", "expired_hold"],
  ["pending_payment", "PAYMENT_VERIFIED", "confirmed"],
  ["pending_payment", "PAYMENT_FAILED", "hold"],
  ["pending_payment", "CANCEL", "cancelled_before_payment"],
  ["confirmed", "SESSION_STARTED", "live"],
  ["confirmed", "HOST_CANCELS", "cancelled_by_host"],
  ["confirmed", "BOOKER_CANCELS", "cancelled_by_booker"],
  ["live", "SESSION_ENDED", "completed"],
  ["live", "HOST_NO_SHOW", "no_show_host"],
  ["live", "BOOKER_NO_SHOW", "no_show_booker"],
  ["completed", "PAYOUT_EXECUTED", "settled"],
  ["completed", "DISPUTE_OPENED", "disputed"],
  ["cancelled_by_host", "REFUND_EXECUTED", "refunded"],
  ["cancelled_by_booker", "REFUND_EXECUTED", "refunded"],
  ["no_show_host", "REFUND_EXECUTED", "refunded"],
  ["no_show_booker", "PAYOUT_EXECUTED", "settled"],
  ["disputed", "DISPUTE_RESOLVED_HOST", "settled"],
  ["disputed", "DISPUTE_RESOLVED_BOOKER", "refunded"],
];

for (const [from, event, to] of ALLOWED) {
  TRANSITIONS.set(`${from}|${event}`, to);
}

export function canTransition(from: BookingState, event: BookingEvent): boolean {
  return TRANSITIONS.has(`${from}|${event}`);
}

export function applyTransition(state: BookingState, event: BookingEvent): BookingState {
  const key = `${state}|${event}`;
  const next = TRANSITIONS.get(key);
  if (next === undefined) {
    throw new Error(`illegal transition: ${state} + ${event}`);
  }
  return next;
}
