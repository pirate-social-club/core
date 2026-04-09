# Livestream

Status: draft

Related docs:

- [club.md](./club.md)
- [post.md](./post.md)
- [marketplace.md](./marketplace.md)
- [monetization.md](./monetization.md)
- [donations.md](./donations.md)
- [performance.md](./performance.md)
- [rights-review.md](./rights-review.md)
- [replay.md](./replay.md)
- [live-segments.md](./live-segments.md)

## Purpose

This doc defines how livestreams work in Pirate v2.

It covers:

- the canonical `live_room` object
- the relationship between a livestream and its anchor post
- room lifecycle
- live and replay access
- performer participation boundaries
- recording and recognition boundaries
- donation behavior during live events

## Non-goals

This doc does not define:

- Agora or other broadcast vendor details
- low-level media transport
- a separate live-ticket commerce protocol
- live moderation tooling in full detail

## Core Principle

A livestream is not a post type.

A livestream is a first-class room/session object with an associated anchor post.

Recommended v0 split:

- `live_room` owns scheduling, room state, access, and replay linkage
- `anchor_post_id` points to the post used for feed distribution, discussion, and later replay discovery
- the initial setlist is authored as part of room creation, even though song-level lifecycle lives in [live-segments.md](./live-segments.md)

This avoids collapsing room lifecycle into the normal post lifecycle.

## Control Plane vs Broadcast Plane

Room authoring and room hosting should not be conflated.

Recommended v0 split:

- web/app composer owns control-plane authoring for the room
- desktop or host tooling may attach to an existing room as the host client
- the control plane remains the source of truth for title, schedule, anchor post, listing, and donation/club policy

This means Pirate should prefer:

1. create or schedule the room through the composer on web/app
2. persist `live_room_id`, `anchor_post_id`, and any listing linkage
3. let desktop hook into that existing room for host/performance duties

Rather than:

- treating the desktop app as the primary author of club commerce and social objects

## Audience Plane vs Performance Plane

Recommended v0 media split:

- Agora is the audience broadcast rail
- JackTrip remains relevant for low-latency performer collaboration

Interpretation:

- viewers should watch through the normal livestream/watch surfaces backed by Agora
- performers may collaborate through JackTrip or similar low-latency tooling
- a performer session may feed the live broadcast mix without becoming the viewer delivery protocol

## Solo Rooms vs Multi-Performer Rooms

Solo rooms should not require desktop/native host tooling in v0.

Recommended v0 split:

- `room_kind = solo` may be created on web/app and hosted either from a web host console or from desktop
- desktop is optional for solo rooms and should be treated as a better performance tool, not a mandatory dependency
- `room_kind = duet` is where desktop/native performance tooling becomes materially more important
- JackTrip is relevant for multi-performer collaboration, not for ordinary solo broadcasting

This means GPUI or other desktop host tooling should be thought of as:

- optional for solo host flows
- strongly preferred for low-latency multi-musician flows

## Canonical Object

Suggested v0 `live_rooms` shape:

- `live_room_id`
- `club_id`
- `anchor_post_id`
- `host_user_id`
- `title`
- `description` nullable
- `status`
- `access_mode`
- `room_kind`
- `visibility`
- `guest_user_id` nullable
- `listing_id` nullable
- `replay_listing_id` nullable
- `broadcast_ref` nullable
- `event_start_at` nullable
- `live_started_at` nullable
- `ended_at` nullable
- `canceled_at` nullable
- `cover_ref` nullable
- `participant_capacity` nullable
- `replay_asset_id` nullable
- `replay_status`
- `created_at`
- `updated_at`

Suggested meanings:

- `status`
  - `scheduled`
  - `live`
  - `ended`
  - `canceled`
- `access_mode`
  - `free`
  - `gated`
  - `paid`
- `room_kind`
  - `solo` — single host broadcasting
  - `duet` — host plus one invited collaborator
  - Old Pirate used `dj_set` for solo; `solo` is the cleaner v2 name. `duet` carries forward as the structured multi-performer case in v0.
- `visibility`
  - `public` — discoverable in live discovery
  - `unlisted` — accessible by direct link only
- `guest_user_id`
  When `room_kind` is `duet`, this points to the invited collaborator. Nullable for solo rooms. For migration, an additional `guest_wallet_attachment_id` may be carried temporarily until wallet-to-user mapping stabilizes.
- `performer_allocations`
  Ordered allocation records describing how the performer-side proceeds are split across the room participants.
- `broadcast_ref`
  Provider-specific broadcast session reference used by live media infrastructure. Provisioned at host-attach or room-start time, not at room creation time. See Host Attach below.
- `event_start_at`
  The announced or planned start time shown before the stream begins. When `event_start_at` is null, the room is immediately ready for the host to go live. When non-null, the room is scheduled for that time and the host cannot start until the scheduled window.
- `live_started_at`
  The actual time the room entered the live state
- `cover_ref`
  Pointer to the stream's cover image or thumbnail media
- `participant_capacity`
  Optional audience cap when product or infrastructure policy imposes a room limit
- `replay_status`
  - `none`
  - `processing`
  - `review_pending`
  - `published`
  - `failed`
- `performer_allocations`
  - for `solo`, exactly one allocation for the host with `share_pct = 100`
  - for `duet`, exactly two allocations whose `share_pct` values sum to `100`

Rules:

- every livestream must have exactly one `anchor_post_id`
- `anchor_post_id` must point to a normal post row, not a separate live-only content type
- `broadcast_ref` is nullable and remains null until the host attaches and broadcast infrastructure is provisioned
- `listing_id` is used only when live access is paid
- `replay_listing_id` is used only when replay access is separately monetized
- `replay_status` tracks replay processing and rights-review state without mutating the room lifecycle itself
- `club_id` is required at creation. There are no standalone room objects outside a club context. A live room is a club object with an anchor post from day one.
- room creation should also require an initial setlist payload, even if that setlist begins in `draft`
- room creation should require explicit performer allocations from day one
- web/app is the authoritative creation surface for `live_room` in v0; desktop controls host start/stop and performer tooling only
- the old Pirate `created` status is collapsed into `scheduled` in v0. `event_start_at = null` means "ready now". `event_start_at != null` means "scheduled for later". This removes the ambiguous `created` state that old Pirate used.

Identity shift from old Pirate:

- old Pirate identified hosts by wallet address (`host_wallet`). v2 uses `host_user_id` backed by the Pirate app session, with wallet addresses modeled as attachments rather than canonical identifiers. The API should enforce this consistently: no core write endpoint should key identity by raw wallet address alone.

## Performer Participation Boundary

The `live_room` row should stay small even when many musicians are involved.

Recommended v0 rule:

- `host_user_id` is the canonical room host
- `guest_user_id` supports the single invited-collaborator case for `duet`
- performer allocations must be explicit from creation time onward
- larger open-ended performer rosters should not be part of v0 live rooms

Interpretation:

- `solo` rooms need only `host_user_id`
- `duet` rooms use `guest_user_id` for the second performer
- performer allocation records should identify who participates in performer-side proceeds and at what percentages
- if Pirate later supports larger multi-performer rooms, they should use a stricter performer-roster child resource rather than an unstructured room kind

Commerce boundary:

- paid room access sells access to the room first
- v0 live access revenue should follow the room listing plus the club payout policy, then apply the room's explicit performer allocations to the performer-side proceeds
- song-specific or segment-specific rights settlement still comes later through segment resources, replay assets, and royalty-graph-backed settlement rather than raw room-level split fields

## Anchor Post

The anchor post is the social object associated with the livestream.

The anchor post is responsible for:

- feed visibility
- comments and replies
- title/announcement rendering
- replay discovery after the stream ends

The anchor post does not own:

- broadcast session state
- join/access state
- live-room lifecycle

Recommended v0 rule:

- the anchor post should normally be a `video` post with `anchor_live_room_id` in read models or join-layer relations
- if the client does not provide an existing `anchor_post_id`, Pirate should create the anchor post automatically as part of room creation
- the anchor post for a live room should not use the club anonymous identity layer in v0; live-room authority stays tied to the host's verified public identity

## Room Lifecycle

Recommended v0 lifecycle:

- `scheduled`
- `live`
- `ended`
- `canceled`

Transition guidance:

- creation starts at `scheduled`
- once the host actually begins the session, the room becomes `live`
- when the session finishes normally, the room becomes `ended`
- if the event is called off before or during operation, the room becomes `canceled`

Authority guidance:

- host start should also require a valid active setlist as defined in [live-segments.md](./live-segments.md)
- the host may transition `scheduled -> live`
- the host may transition `live -> ended`
- the host, `club_owner`, `moderator`, or `platform_admin` may transition a room to `canceled`
- `club_owner`, `moderator`, and `platform_admin` may forcibly end a room for moderation, safety, or operational reasons

Guest termination on cancellation:

- when a room is canceled, any attached guest or collaborator state is revoked
- guest broadcast credentials (bridge tickets, Agora tokens) should be invalidated
- this applies whether the cancellation is initiated by the host, a moderator, or the club owner

## Replay Model

Replay availability should not be a top-level room status.

Recommended v0 rule:

- replay is derived from `status = ended` plus successful replay attachment

Suggested replay fields:

- `replay_asset_id` nullable
- `replay_listing_id` nullable
- `replay_status`

Interpretation:

- `replay_status = none` means no replay exists yet
- `replay_status = processing` means replay generation is underway
- `replay_status = review_pending` means replay exists or is nearly ready but is held pending rights review
- `replay_status = published` means replay is cleared for product use
- `replay_status = failed` means replay processing failed without changing the room lifecycle
- if `replay_asset_id` is non-null, replay media exists at the asset layer
- if `replay_listing_id` is also non-null, replay access may be separately sold once replay is cleared for publication
- if replay is separately sold, the replay asset should be locked and delivered through Pirate's CDR-compatible asset-access path rather than exposed as a plain public payload

## Recording And Recognition

Recording and music recognition are related but not the same thing.

Recommended v0 rule:

- a room may later produce a replay asset derived from the mixed live output
- ACRCloud should be used for music recognition on the live mix or replay asset, not for room identity
- recognition should run asynchronously and must not block room creation, host-attach, or go-live

Replay-clearance rule:

- if ACRCloud returns zero confident matches, replay should auto-clear and may advance to `replay_status = published`
- if ACRCloud returns candidate matches, replay should move to `replay_status = review_pending`
- if review rejects all candidate matches, replay may still advance to `replay_status = published`
- if review accepts any candidate match as an upstream reference, replay may advance to `replay_status = published` only after the corresponding derivative links or royalty-graph edges are attached according to policy
- replay may only advance to `published` when all relevant live segments are effectively clear; any segment with `rights_status = review_pending`, `blocked`, or reconciliation requiring review should keep the replay in review

Review authority:

- in v0, ACRCloud-triggered rights review is a Pirate platform function, not a club-owner or TLD-owner function
- the Pirate platform operator is the final authority for clearing or blocking replay publication and rights-sensitive payouts on flagged rooms
- hosts, guests, club owners, and TLD owners may submit context, claimed licenses, or official-catalog evidence, but they do not have unilateral final-clearance authority for third-party rights cases
- this avoids self-review by economically interested room operators and keeps rights enforcement consistent across clubs

Rights boundary:

- songs performed inside a club are not automatically royalty-free merely because they are inside that club
- Story-published works are not automatically "fair game" for unrestricted live performance or monetization
- Pirate may parse Story-linked rights metadata and community relationships as evidence that a work is licensable or officially supported, but monetization policy must still check whether the rights path actually permits the use
- club-affiliated or officially linked catalog works may be allowlisted by product policy later, but that should be explicit policy, not an inference from club membership alone

Good v0 uses for live recognition:

- "now playing" hints on a live room or replay page
- moderation and copyright review support
- suggested replay metadata or chapter markers
- candidate evidence for later segment or royalty review

Important boundary:

- ACRCloud recognition on a livestream should not automatically rewrite payout splits in real time in v0
- recognition produces evidence and product metadata first; money-routing changes still require the later segment or replay-rights path
- when ACRCloud produces a rights-relevant match, replay publication and rights-sensitive payout release should be delayed until Pirate platform review resolves the case

## Cancellation Behavior

Cancellation must not silently destroy the discussion anchor.

Recommended v0 rule:

- when a room is `canceled`, the anchor post remains visible
- the anchor post should render a cancellation notice rather than disappearing
- comments may remain readable subject to later moderation policy
- if `listing_id` or `replay_listing_id` exists, those listings should be paused for new purchases until the room is rescheduled or replay policy is refreshed
- refund policy for already-settled purchases is a later commerce-policy decision and should not be silently inferred from room cancellation alone

This preserves feed integrity and avoids broken links for scheduled events that had already propagated.

## Access And Entitlement

Livestream access should reuse Pirate's normal commerce and entitlement model.

Recommended v0 access modes:

### `free`

- anyone who satisfies normal club viewer rules may join

### `gated`

- club viewer or membership gates must pass before join
- no payment is implied

Recommended v0 boundary:

- v0 should reuse existing club gate evaluation rather than inventing a separate room-specific gate object
- room-specific audience segmentation may be added later after the base gate model hardens

### `paid`

- live access is sold through a normal listing and purchase entitlement flow
- `listing_id` points to the active commerce object

Rules:

- do not invent a separate live-ticket protocol in v0
- if a livestream costs money, that should be represented through the existing listing/purchase/entitlement model
- replay access may reuse the same entitlement or use a separate replay listing, depending on club policy
- if replay access is paid or otherwise entitlement-gated, the replay should be represented by a locked replay asset rather than a publicly readable payload
- implementations should enforce a maximum room duration and auto-end stale rooms after an operational timeout, but the exact timeout is an implementation detail rather than a product field in v0
- `participant_capacity`, when present, is enforced by room or broadcast control logic rather than by marketplace settlement

## Relationship To Marketplace

The marketplace remains the commerce layer.

Recommended v0 interpretation:

- a paid livestream sells access to a live-room entitlement
- a paid replay sells access to a replay entitlement
- the buyer-facing listing is still a normal marketplace listing even when the thing being unlocked is live-room access rather than a static asset payload
- free replay may remain publicly playable, but paid replay should resolve to a locked replay asset delivered through the normal entitlement path

This avoids a parallel live-commerce surface.

## Donations During Live

Livestreams must follow the same donation policy as the rest of the club.

Recommended v0 rule:

- no per-room arbitrary donation beneficiary
- if the club has an active donation partner, monetized livestreams may expose the same creator-side donation sidecar model already defined elsewhere
- fundraiser-first live events are a later extension, not a separate v0 exception

This keeps live donations aligned with the club's approved charitable partner.

Transition from old Pirate:

- old Pirate had per-room Endaoment configuration (`endaoment_org_id`, `endaoment_org_name`, `endaoment_org_logo_url`, `donation_goal`) directly on the live room object
- v2 intentionally moves charitable identity to the club level, not the room level
- this is a product change, not an omission: per-room donation beneficiaries are replaced by club-scoped donation policy
- rooms in clubs with an active donation partner may still display the donation sidecar, but the configuration lives on the club, not the room

## Club And Moderation Interaction

Livestreams are club-scoped objects.

Rules:

- `club_id` controls the room's moderation, visibility, and eligibility context
- only actors with `schedule_livestream` permission may create rooms
- room cancellation, hiding the anchor post, and replay removal should remain separately controllable moderation actions

## Host Attach

In old Pirate, the desktop app creates the room and then directly calls `/live/:id/start` to begin broadcasting. In v2, the control plane owns room creation, and the performance plane attaches to an existing room.

Recommended v2 host-attach flow:

1. web/app creates the room via the control-plane API
2. desktop or native host tooling calls `POST /live-rooms/{live_room_id}/host-attach`
3. the API returns host credential material: bridge token, Agora channel, broadcaster token, broadcast handoff parameters
4. the host client joins Agora and begins broadcasting

This replaces the old model where desktop owned creation and then opened a browser URL with embedded credentials. The new model keeps creation authority on web/app while giving the performance client everything it needs to go live.

`broadcast_ref` is provisioned at host-attach time, not at room creation time. This means:

- the room object may not have a broadcast channel until the host attaches
- viewer pages should be prepared for rooms that are `scheduled` but have no `broadcast_ref` yet
- host-attach is idempotent for a given host session: calling it again returns the same or refreshed credentials

## Open Questions

- Should paid live access and paid replay default to one entitlement or two separate listings in v0?
- Should live-room metadata edits such as title, cover, and scheduled time use a dedicated PATCH endpoint in the first public API pass?
- Should desktop ever directly author `live_room` objects in production, or should it remain a host/performance client attached to rooms created by web/app?
- Should club-gated livestreams support room-specific audience segments in v0, or should that wait until after the base club-gate model hardens?
- Should gated access mode gain a subfield like `gate_mode` or `audience_gate_ref` to encode segment types (purchase_entitlement, scrobble_threshold, study_streak, wallet_allowlist) from old Pirate, or should v0 rely on club-level gate evaluation and defer room-specific audience segmentation?
