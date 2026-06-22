# @pirate/bookings-domain

Pure TypeScript domain package for 1:1 paid video session bookings.

**Normative spec:** `core/specs/domain/paid-bookings.md` (§3). This file is a pointer;
the canonical spec lives in `core/`.

## Purity contract

No I/O, no DB, no framework, no ambient time. Concretely `src/` must not:

- import `react` / `react-dom`
- call `Date.now()`, `Math.random()`, `crypto.randomUUID()`
- import `node:fs` / `node:net` / `node:http` / any DB driver
- import the `./test` subpath

`rtk bun run lint:imports` enforces this. Time is always passed in as `nowUtc`.

## Layout

- `src/types.ts` — domain types (§3.1)
- `src/fsm.ts` — booking state machine (`canTransition`, `applyTransition`)
- `src/availability.ts` — `resolveSlots` (rules + exceptions + busy → bookable slots)
- `src/pricing.ts` — `resolvePrice` (variable price rules)
- `src/allocation.ts` — `computeAllocation` (fee split snapshot)
- `src/quote.ts` — `buildQuotePreview` (price + fee bound to a held slot)
- `src/refund.ts` — `resolveRefund` (refund / payout on lifecycle resolution)

## Tests

`rtk bun test tests/` — written failing first (red), per §3.3.
