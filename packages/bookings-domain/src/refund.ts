import type {
  BookingAllocation,
  Cents,
  RefundResolution,
  ResolveRefundInput,
} from "./types";
import { parseIso } from "./time";

function halfUpRoundCents(grossCents: Cents, bps: number): Cents {
  return Math.floor((grossCents * bps + 5000) / 10000);
}

function grossFromAllocation(allocation: BookingAllocation): Cents {
  return allocation.legs.reduce((acc, leg) => acc + leg.amountCents, 0);
}

function feeShareBpsFromAllocation(allocation: BookingAllocation): number {
  return allocation.legs.find((l) => l.recipientType === "platform_fee")?.shareBps ?? 0;
}

function determineRefundBps(input: ResolveRefundInput): number {
  switch (input.state) {
    case "cancelled_before_payment":
      return 0;
    case "cancelled_by_host":
      return 10000;
    case "cancelled_by_booker": {
      const slotStartMs = parseIso(input.slotStartUtc);
      const nowMs = parseIso(input.nowUtc);
      const windowCutoff = slotStartMs - input.policy.cancellationWindowSeconds * 1000;
      if (nowMs <= windowCutoff) return 10000;
      return input.policy.refundPolicy.bookerCancelAfterWindowRefundBps;
    }
    case "no_show_host":
      return input.policy.refundPolicy.noShowByHostRefundBps;
    case "no_show_booker":
      return input.policy.refundPolicy.noShowByBookerRefundBps;
    case "completed":
      return 0;
    default:
      return 0;
  }
}

export function resolveRefund(input: ResolveRefundInput): RefundResolution {
  if (input.state === "cancelled_before_payment") {
    return { refundCents: 0, hostPayoutCents: 0, platformFeeCents: 0 };
  }

  const gross = grossFromAllocation(input.allocation);
  const refundBps = determineRefundBps(input);
  const refund = halfUpRoundCents(gross, refundBps);
  const remaining = gross - refund;

  if (remaining === 0) {
    return { refundCents: refund, hostPayoutCents: 0, platformFeeCents: 0 };
  }

  const feeShareBps = feeShareBpsFromAllocation(input.allocation);
  const fee = halfUpRoundCents(remaining, feeShareBps);
  const host = remaining - fee;

  return { refundCents: refund, hostPayoutCents: host, platformFeeCents: fee };
}
