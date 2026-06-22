import { describe, expect, test } from "bun:test";
import { applyTransition, canTransition } from "../src/fsm";
import type { BookingEvent, BookingState } from "../src/types";

// Source-of-truth allow-list for the red phase. The implementation must match this.
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

const TERMINAL: BookingState[] = ["settled", "refunded", "expired_hold", "cancelled_before_payment"];

const ALL_STATES: BookingState[] = [
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

const ALL_EVENTS: BookingEvent[] = [
  "QUOTE_BUILT",
  "QUOTE_DROPPED",
  "HOLD_EXPIRED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "CANCEL",
  "SESSION_STARTED",
  "SESSION_ENDED",
  "HOST_CANCELS",
  "BOOKER_CANCELS",
  "HOST_NO_SHOW",
  "BOOKER_NO_SHOW",
  "PAYOUT_EXECUTED",
  "REFUND_EXECUTED",
  "DISPUTE_OPENED",
  "DISPUTE_RESOLVED_HOST",
  "DISPUTE_RESOLVED_BOOKER",
];

function isAllowed(from: BookingState, event: BookingEvent): boolean {
  return ALLOWED.some(([f, e]) => f === from && e === event);
}

describe("booking FSM — legal transitions", () => {
  for (const [from, event, to] of ALLOWED) {
    test(`${from} + ${event} -> ${to}`, () => {
      expect(canTransition(from, event)).toBe(true);
      expect(applyTransition(from, event)).toBe(to);
    });
  }
});

describe("booking FSM — illegal transitions (exhaustive)", () => {
  for (const from of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (isAllowed(from, event)) continue;
      test(`${from} + ${event} is rejected`, () => {
        expect(canTransition(from, event)).toBe(false);
        expect(() => applyTransition(from, event)).toThrow();
      });
    }
  }
});

describe("booking FSM — terminal states accept nothing", () => {
  for (const state of TERMINAL) {
    for (const event of ALL_EVENTS) {
      test(`terminal ${state} + ${event} is rejected`, () => {
        expect(canTransition(state, event)).toBe(false);
        expect(() => applyTransition(state, event)).toThrow();
      });
    }
  }
});
