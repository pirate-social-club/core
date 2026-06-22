import type { BookingPolicy, BookingQuotePreview, IsoInstant, ResolvedSlot } from "./types";
import { computeAllocation } from "./allocation";
import { parseIso, toIso } from "./time";

export function buildQuotePreview(
  slot: ResolvedSlot,
  policy: BookingPolicy,
  nowUtc: IsoInstant,
): BookingQuotePreview {
  const grossCents = slot.priceCents;
  const allocation = computeAllocation(grossCents, policy);
  const platformFeeCents = allocation.legs.find((l) => l.recipientType === "platform_fee")?.amountCents ?? 0;
  const hostPayoutCents = allocation.legs.find((l) => l.recipientType === "host")?.amountCents ?? 0;
  const expiresAtUtc = toIso(parseIso(nowUtc) + policy.holdTtlSeconds * 1000);

  return {
    slot,
    grossCents,
    platformFeeCents,
    hostPayoutCents,
    allocation,
    expiresAtUtc,
  };
}
