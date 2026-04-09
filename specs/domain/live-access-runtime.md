# Live Access Runtime

Status: draft

Related docs:

- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [marketplace.md](./marketplace.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [../contracts/locked-asset-delivery.md](../contracts/locked-asset-delivery.md)

## Purpose

This doc defines the runtime behavior of paid and gated live-room access in v0.

It covers:

- what a paid live purchase actually grants
- how join authorization works at runtime
- reconnect and late-join behavior
- the relationship between paid live access and replay access
- what remains app/runtime policy rather than contract logic

## Core Principle

Paid live access uses the same commerce spine as other Pirate purchases, but a different consumption surface.

- settlement still finalizes the purchase
- the buyer still receives an entitlement
- the runtime checks that entitlement at join time rather than decrypting a static payload

User-facing interpretation:

- the buyer experiences a "ticket"
- Pirate models that ticket as a durable purchase entitlement plus room-access runtime checks

## Non-Goals

This doc does not define:

- Agora-specific token formats
- moderation ejection tooling in full detail
- desktop host UX
- replay media processing internals

## Access Modes

### `free`

- any viewer who satisfies ordinary club viewing policy may join when the room is live

### `gated`

- no payment is implied
- join requires all active `membership`-scope and `viewer`-scope community gates to pass

### `paid`

- join requires the ordinary room/community gate checks plus a successful paid-room entitlement check
- paid rooms should be `public` in v0
- `unlisted + paid` is intentionally out of scope in v0 because it creates an awkward discoverability and purchase state without enough product benefit

## What A Paid Live Purchase Grants

Recommended v0 rule:

- a successful paid live purchase grants the buyer a durable app-level entitlement to join that room
- the room may present this to the user as a ticket, but the backend should treat it as ordinary purchase entitlement state
- the entitlement should be reusable for reconnects and later join attempts while the room remains eligible for entry

This avoids making live access a one-shot nonce or ephemeral ticket artifact.

## Join Authorization

Recommended v0 join check order:

1. room exists and is not canceled
2. room status is `live`
3. viewer satisfies visibility requirements for the room URL/surface
4. viewer satisfies all applicable community gates
5. if `access_mode = paid`, viewer has the required purchase entitlement
6. runtime issues or refreshes join credentials

Interpretation:

- `scheduled` rooms do not permit audience join yet
- `ended` rooms do not permit live join even if the user bought access
- purchase entitlement alone is not enough; room lifecycle still matters

## Reconnect Behavior

Recommended v0 rule:

- reconnect should be allowed without repurchase as long as the room is still `live` and the viewer still satisfies the same gate and entitlement checks
- reconnect should reuse the same durable purchase entitlement rather than minting or issuing a second access object
- runtime join credentials may rotate or expire, but entitlement does not

This means:

- expiring Agora or bridge tokens are transport/session credentials
- purchase entitlement is the commerce credential

## Late Join Behavior

Recommended v0 rule:

- buyers may join late while the room is still `live`
- Pirate should not make room-entry eligibility depend on whether the buyer was present at the exact start time
- room policy may later add stricter event-start windows, but v0 should not

This keeps paid live closer to buying access to an event rather than buying a single-use door timestamp.

## Cancellation And End State

Rules:

- if the room is `canceled`, no live join is allowed
- if the room is `ended`, no live join is allowed
- purchase entitlements remain part of the purchase record even when the room is no longer joinable
- any replay benefit is resolved separately through replay policy

## Replay Relationship

Paid live and replay should be related but not collapsed into one hardwired rule.

Recommended v0 posture:

- paid live should default to `replay_included = true` in v0 when replay is retained and later published
- the room may explicitly override that default and choose separate replay monetization instead
- the room may also choose free replay after the live event
- replay may instead be sold separately through `replay_listing_id`
- replay entitlement reuse should be explicit room policy, not an accidental side effect

This yields three clean cases:

1. paid live only
   - purchase grants room join only
   - this is an explicit override from the default included-replay posture
2. paid live plus replay included
   - live purchase entitlement also authorizes replay access
3. paid live plus separately monetized replay
   - live join entitlement and replay entitlement are distinct

Recommended product default:

- if replay is retained and clears publication, paid live should default to included replay access
- creators or clubs may override that default and make replay free for everyone or separately monetized

## Runtime Read Model

Recommended v0 live access view should make the runtime decision legible without leaking internal implementation detail.

Suggested fields:

- `live_room_id`
- `access_mode`
- `join_state`
- `listing_id` nullable
- `viewer_entitled`
- `replay_available`
- `replay_included`
- `reason` nullable

Suggested meanings:

- `join_state`
  - `allowed`
  - `gate_failed`
  - `payment_required`
  - `not_live`
  - `ended`
  - `canceled`
- `viewer_entitled`
  - whether the viewer currently satisfies the paid-room purchase check
- `replay_included`
  - whether the room's live purchase entitlement also covers replay

## Contract Boundary

Onchain:

- settlement finalizes purchase
- purchase entitlement state may be represented by normal purchase/entitlement primitives

Offchain/runtime:

- room status checks
- gate evaluation
- join authorization
- reconnect issuance
- replay-included policy resolution

The runtime must not assume `msg.sender` or wallet state alone is the whole answer for live join. Room lifecycle and community gate evaluation remain app/runtime concerns.

## Cover And Presentation

`cover_ref` belongs to the `live_room`.

Recommended v0 rule:

- the room cover is optional
- when present, it should be the primary visual media for scheduled-room and room-header presentation
- the anchor post may render that cover, but the cover is not a separate paid asset and not a separate post type

## V0 Simplicity Rules

- do not invent a separate live-ticket token standard
- do not require a separate one-time ticket scan flow
- do not require viewers to repurchase for reconnect
- do not require a separate teaser-video asset for locked premium video posts

## Open Questions

None in this area.
