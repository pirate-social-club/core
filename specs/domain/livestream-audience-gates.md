# Livestream Audience Gates (Gated v1.5)

Status: Draft — green-lit for implementation 2026-07-07
Scope: Extends `access_mode = "gated"` on `live_rooms` from community-member-only to a small,
explicit set of audience gate segments, starting with purchase-entitlement ("buyers of selected
song X can enter this gated live room").

Related: [livestream.md](./livestream.md) (access modes, lifecycle),
[live-access-runtime.md](./live-access-runtime.md) (join-time authorization),
[donations.md](./donations.md), [community.md](./community.md) (community gate families — distinct
from room audience gates; see §9).

---

## 1. Problem Statement

Today `access_mode = "gated"` means **community-member-only** and nothing else:

- Authenticated resolution (`live-rooms/access.ts`) throws `notFoundError` at the top of
  `resolveLiveRoomViewerAccess` for any non-producer, non-owner/admin/moderator whose
  `membership_status !== "member"` — **before** `access_mode` is inspected. Membership is a
  **universal precondition** for the entire authed viewer path.
- Public resolution rejects gated rooms with `membership_required` unconditionally.

The headline v1.5 use case is: **a non-member who bought selected song X can enter a gated live
room.** Buying a song is exactly what a non-member does, so the universal membership precondition
directly blocks the headline case.

**Therefore membership cannot remain a universal precondition.** Removing that trap is a
first-class requirement of this spec (§2), not an implementation detail. A gate pass must grant
access *regardless of membership*.

## 2. Access Resolution Contract (FIRST-CLASS REQUIREMENT)

The authenticated viewer access resolution MUST be restructured so the room gate is an
**alternative admission path**, not a filter applied after membership has already rejected the
viewer. Ordered logic for a `gated` room:

1. **Privileged bypass** — if the viewer is producer / host / guest / owner / admin / moderator,
   they are admission-eligible. (Unchanged; still highest priority.)
2. **Gate evaluation** — if `live_rooms.audience_gate_json` is present, evaluate it (§4, §5).
   - **Pass → admission-eligible regardless of community membership.**
   - **Fail → return a structured gate denial** (`decision_reason = "gate_unsatisfied"`, §6). Do
     NOT fall through to the membership check.
3. **Legacy fallback** — if `audience_gate_json` is null, apply the current behavior: require
   `membership_status = "member"`, else `membership_required`.

**Admission eligibility is NOT terminal `allowed = true`.** A gate pass (or privileged bypass, or
legacy membership) establishes *admission eligibility only*. The existing downstream checks still
run and decide the final `allowed` value: unlisted-visibility readability
(`canReadUnlistedLiveRoom`) and lifecycle status (`canceled` → `canceled`, `ended` → `ended`,
non-`live` → `not_live`, per `access.ts` ~line 114). So a viewer who satisfies a gate on a room
that is `scheduled`/`ended`/`canceled` still resolves to `allowed = false` with the corresponding
lifecycle reason — the gate does not short-circuit lifecycle. Ordering: privileged/gate/membership
admission decision **first**, then visibility, then lifecycle status, then `allowed = true`.

`free` and `paid` behavior is unchanged; audience gates apply to `gated` only in v1.5. The current
authenticated `paid` path still inherits the existing community-membership precondition before the
`live_room_access` entitlement check. That means "paid access for non-members" is a separate
product/access-policy decision, not part of this spec. If paid rooms are later opened to
non-members, that work needs its own access-resolution contract and regression test for a
non-member ticket holder.

The current top-of-function `notFoundError` membership precondition (`access.ts` ~line 74) MUST be
removed or made gate-aware so it cannot short-circuit step 2. Its unlisted-visibility check
(`canReadUnlistedLiveRoom`) is retained as a separate concern.

**Explicit regression requirement:** a non-member who holds an active `asset_access` entitlement
for a gate's target song, on a room that is `live` and readable, MUST resolve to `allowed = true`.
This is the single most important behavior in this spec and MUST have a dedicated test (§8). A
companion test MUST assert the same gated-pass viewer on a non-`live` room resolves to
`allowed = false` with the lifecycle reason (not `gate_unsatisfied`), pinning the eligibility ≠
terminal-allowed distinction.

### Public / anonymous path

`resolvePublicLiveRoomViewerAccess` continues to reject `gated` rooms. In v1.5, all audience gates
are user-authenticated only, so anonymous viewers cannot satisfy any gate. The public path returns
`gate_unsatisfied` (rather than the older `membership_required`) for gated rooms whose gate is not
anonymously resolvable, so denial semantics are consistent across paths. Anonymous wallet-resolvable
access is explicitly out of scope (§7) but the payload and segment interface MUST NOT preclude it.

## 3. Storage Decision (FIRST-CLASS REQUIREMENT)

v1.5 stores the gate **inline** on the room. No reusable gate-definition table is introduced.

- Add `live_rooms.audience_gate_json` (nullable TEXT, JSON-encoded).
- **Null** means legacy gated behavior only (member-only fallback, §2 step 3). Null is reserved
  **strictly** for legacy rows; it MUST NOT be overloaded to mean "newly chosen member-only."
- **New gated rooms MUST write an explicit gate**, including the member-only case as
  `{ "type": "community_members" }`. This keeps "legacy member-only" and "deliberately chose
  member-only" distinguishable, which the null-vs-explicit split exists to preserve.
- A reusable/referenced gate-definition table is **deferred** until there is real cross-room reuse
  pressure. One room, one inline gate for v1.5.

### Shape

```jsonc
// live_rooms.audience_gate_json
{
  "version": 1,
  "segments": [
    { "type": "community_members" },
    {
      "type": "purchase_entitlement",
      "entitlement_kind": "asset_access",
      "target_refs": ["<asset_id>", "..."]   // explicit selected assets only
    }
  ],
  "match": "any"   // v1.5: "any" only — pass if the viewer satisfies ANY segment
}
```

v1.5 supports `match: "any"` only. `"all"` (must satisfy every segment) is a forward-compatible
field but not implemented; validation MUST reject unknown `match` values rather than silently
treat them as `any`.

### 3a. ID serialization (FIRST-CLASS REQUIREMENT — boundary contract)

The codebase separates **internal IDs** (raw shard row ids used in SQL) from **public IDs**
(prefixed, encoded via `publicId(id, prefix)` / `decodePublicId(value, prefix)` in
`src/lib/public-ids.ts` — e.g. `lst` for listings, `pq` for quotes, `post` for posts). The
existing live-room access payload already follows this: `serializeLiveRoomAccess` emits `listing`
as `publicId(row.listing_id, "lst")` (a string), and carries **no price field** at all.
`audience_gate_json` and the denial payload MUST honor the same boundary:

- **Stored `audience_gate_json` uses internal asset IDs** in `target_refs` — because gate
  evaluation calls `getActiveEntitlementForBuyer(..., targetRef, ...)`, whose `target_ref` column
  is the internal id. Storing internal ids avoids a decode on every access check.
- **Create/update API accepts PUBLIC asset IDs** and decodes them (`decodePublicId(value,
  <assetPrefix>)`) before persisting into `audience_gate_json`. Clients never send internal ids.
  Invalid/undecodable ids are a validation error at write time.
- **Access/denial responses emit PUBLIC IDs only.** `required_target_refs` in the denial payload
  (§6) MUST be public asset ids; internal ids MUST NOT leak into any response.
- **Listing refs follow the existing convention**, not an invented shape. A purchasable listing
  reference is the public listing id string (`publicId(listing_id, "lst")`), exactly as
  `serializeLiveRoomListing` already returns. If a price is surfaced alongside it, use
  **`price_cents: number`** (the representation web's `CommunityListing`/client types already use —
  `client-api-types.ts:806`), NOT an ad hoc `price_usd` string. Prefer reusing the existing
  listing-summary shape over minting a new one.

## 4. Gate Segment Types (v1.5)

Two segment types only:

- **`community_members`** — satisfied when the viewer's `membership_status = "member"` (or a
  privileged role, though those already bypass in §2 step 1). This is the explicit encoding of
  today's implicit behavior.
- **`purchase_entitlement`** — satisfied when the viewer holds an active purchase entitlement for
  one of the listed target refs.
  - `entitlement_kind`: v1.5 supports `"asset_access"` (the kind granted by a song/asset purchase).
  - `target_refs`: **explicit selected song/asset IDs only.** No wildcards, no "any song by host."
  - Satisfied if the viewer holds an active entitlement for **any** target ref in the list.

**Community-shard-local boundary (state explicitly in product copy and API docs):**
`purchase_entitlements` live in the community's own D1 shard and are queried with a
`community_id` filter. A `purchase_entitlement` gate therefore only sees purchases made **within
the same community** as the live room. There is **no** cross-community "buyers of my songs
anywhere" capability, and the product MUST NOT promise one. Since a live room belongs to exactly
one community, this is a natural boundary, not a limitation to apologize for — but it must be
named so nobody builds UI implying cross-community reach.

## 5. Entitlement Evaluation

- **User-authenticated path (v1.5):** for each `purchase_entitlement` segment, for each target
  ref, call
  `getActiveEntitlementForBuyer(client, communityId, userId, targetRef, entitlementKind)`
  (`commerce/queries.ts`). A single non-null active row satisfies the segment. This is the same
  primitive already used for `live_room_access`; no new query machinery is required.
- **Segment interface requirement:** the gate evaluator MUST be structured so a segment can
  declare whether it is **wallet-resolvable**. v1.5 segments are user-id-resolvable only, but the
  interface shape must allow a future wallet-resolvable flag without a breaking change.
- **Future wallet path (NOT v1.5):** `getActiveEntitlementForBuyerIdentity(client, communityId,
  buyer, targetRef, entitlementKind)` is the intended bridge for wallet-keyed entitlements and,
  later, anonymous wallet-verifiable gated access. Named here only to fix the extension point; not
  implemented in v1.5.

## 6. Denial Payload

Extend the existing `decision_reason` enum with **`gate_unsatisfied`**. When a gate fails, the
access resolution MUST return structured metadata so viewer copy and CTAs are **derived from the
payload, not hardcoded guesses**:

```jsonc
{
  "allowed": false,
  "decision_reason": "gate_unsatisfied",
  "gate": {
    "failed_segments": [
      {
        "type": "purchase_entitlement",
        "entitlement_kind": "asset_access",
        "required_target_refs": ["asset_...", "..."], // PUBLIC asset ids only (§3a)
        // Optional: active listings the viewer could purchase to satisfy this gate,
        // so the client can render a working "Purchase to watch →" CTA. Public ids;
        // price as price_cents (§3a), reusing the existing listing-summary shape.
        "purchasable_listings": [
          { "listing": "lst_...", "asset": "asset_...", "price_cents": 750, "status": "active" }
        ]
      }
    ]
  }
}
```

- `purchasable_listings` is optional and best-effort: populate when an active listing exists
  for a required target ref, so the post-card can render a real buy CTA instead of dead text.
- Viewer copy (route + post-card) is downstream of this payload. No component may infer gate
  outcome from anything other than `decision_reason` + `gate`.

### Deterministic `decision_reason` mapping (REQUIRED — no optional behavior)

Failure reason is fixed by which admission path failed, so `null`-vs-explicit gate stays
observable end to end (mirrors the §3 storage invariant):

| Situation | `decision_reason` |
|---|---|
| Legacy `null` gated room, non-member | `membership_required` |
| Explicit `{ type: "community_members" }` gate, non-member | `gate_unsatisfied` (+ `community_members` failed segment) |
| Explicit `purchase_entitlement` gate, non-buyer | `gate_unsatisfied` (+ `purchase_entitlement` failed segment) |
| Public/anonymous request to any explicit-gate room | `gate_unsatisfied` |
| Public/anonymous request to legacy `null` gated room | `membership_required` |

This is deliberately NOT optional: a `community_members` gate failure MUST surface as
`gate_unsatisfied`, never as `membership_required`, so the distinction from a legacy null room is
preserved in the response and not just in storage.

## 7. Out Of Scope

- **Discounts are not gates.** A discount is a pricing rule on a `paid` room; a gate is an
  admission rule on a `gated` room. They MUST NOT be conflated. `audience_gate_json` MUST NOT carry
  any pricing field.
- **Quote-time entitlement discounts** ("discount for buyers of my last song") belong in the
  purchase quote / pricing-rule layer (`purchase_quotes.pricing_tier` / `base_price_usd` /
  `final_price_usd`), evaluated at quote time — not in `audience_gate_json`. Separate spec.
- **"Any song by host"** entitlement matching — out of scope. Selected asset IDs only. May be a
  fast follow but is a different query (resolve host asset set, then OR).
- **`study_streak` and `wallet_allowlist`** segment types — named in the livestream open questions
  as future segments; not in v1.5.
- **Anonymous wallet-verifiable gated access** — out of scope, but the denial payload (§6) and
  segment interface (§5) MUST NOT block it.

## 8. Tests Required

1. Legacy gated room with `audience_gate_json = null` → non-member is denied (member-only
   fallback preserved).
2. Explicit `{ type: "community_members" }` gate → member passes.
3. **Selected-song buyer who is NOT a community member passes** (the precondition-restructure
   regression guard — the headline case).
4. Selected-song non-buyer, non-member → denied with `decision_reason = "gate_unsatisfied"` and a
   `purchase_entitlement` failed segment.
5. Host / admin / owner / moderator bypass still works with a gate present.
6. Anonymous gated access still fails (no wallet-resolvable path in v1.5): explicit-gate room →
   `gate_unsatisfied`; legacy null gated room → `membership_required` (§6 table).
7. **Lifecycle guard:** a viewer who *passes* the gate (buyer or member) on a room that is
   `scheduled`/`ended`/`canceled` resolves to `allowed = false` with the lifecycle reason, NOT
   `gate_unsatisfied` and NOT `allowed = true` — pins admission-eligibility ≠ terminal-allowed (§2).
8. `community_members`-gate non-member → `gate_unsatisfied` (never `membership_required`), and
   legacy null gated non-member → `membership_required` — pins the §6 deterministic mapping.

## 9. Relationship to Community Gates

Community-level admission gates (`community.md` gate families: `erc721_holding`, identity proofs,
etc.) govern **joining the community**. Room audience gates govern **entering a specific live
room**. They are separate layers: a `community_members` room segment defers to community
membership (which was itself gated at join time), while a `purchase_entitlement` segment is
evaluated per-room and independent of community admission. v1.5 does NOT reuse the community gate
family objects for rooms; if room and community gates later need a shared gate-definition model,
that convergence is the trigger for the deferred referenced-table decision (§3).

## 10. Implementation Sequence

1. This spec + migration for `live_rooms.audience_gate_json`.
2. Backend: restructured access resolution (§2), gate evaluator (§4/§5), extended
   `decision_reason` + denial payload (§6). **Lock the denial payload shape first** — viewer CTA
   and composer copy both consume it.
3. Viewer CTA / denial copy (route + post-card), derived from the payload.
4. Composer gate picker on the Live tab (member-only vs buyers-of-selected-song), writing an
   explicit `audience_gate_json` for every new gated room.
5. Tests (§8).

Implementation MUST also, in the same rollout:

- Update the generated community schema snapshot
  (`api/.../provisioning/generated/community-schema-snapshot.ts`) for the new
  `live_rooms.audience_gate_json` column, alongside the core migration.
- Update API and web client/contract types (`@pirate/api-contracts`,
  `web/.../client-api-types.ts`) for the create/update gate input (public asset ids), the extended
  `decision_reason` enum, and the `gate` denial payload.
- Decode public→internal asset ids at the create/update boundary and encode internal→public in the
  access/denial response (§3a), reusing `public-ids.ts` helpers.
