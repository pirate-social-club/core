# API Overview

Status: draft

Related docs:

- [./mpp.md](./mpp.md)
- [../domain/user.md](../domain/user.md)
- [../domain/profile.md](../domain/profile.md)
- [../domain/onboarding.md](../domain/onboarding.md)
- [../domain/guild.md](../domain/guild.md)
- [../domain/artist-catalog.md](../domain/artist-catalog.md)
- [../domain/namespace.md](../domain/namespace.md)
- [../domain/handles.md](../domain/handles.md)
- [../domain/post.md](../domain/post.md)
- [../domain/livestream.md](../domain/livestream.md)
- [../domain/karaoke.md](../domain/karaoke.md)
- [../domain/performance.md](../domain/performance.md)
- [../domain/asset.md](../domain/asset.md)
- [../domain/feed.md](../domain/feed.md)
- [../domain/marketplace.md](../domain/marketplace.md)
- [../domain/monetization.md](../domain/monetization.md)
- [../domain/royalty-graph.md](../domain/royalty-graph.md)
- [../domain/karma.md](../domain/karma.md)
- [../domain/scrobbles.md](../domain/scrobbles.md)
- [../domain/questions.md](../domain/questions.md)
- [../contracts/overview.md](../contracts/overview.md)

## Purpose

This doc defines Pirate's API surface at a systems level before endpoint-level OpenAPI work.

It covers:

- top-level resource families
- sync versus async operations
- write-model versus read-model boundaries
- enforcement points for verification, gating, and access
- major flow composition across onboarding, posting, commerce, and music activity

## Non-goals

This doc does not define:

- exact HTTP paths for every endpoint
- exact request and response schemas
- websocket protocols
- queue or worker implementation details
- internal service boundaries

## Core Principle

Pirate's API should separate:

- authoritative write operations
- asynchronous jobs
- denormalized read surfaces

The write model should stay close to the domain objects.
The read model should optimize for product surfaces such as feeds, profiles, and guild pages.

## API Families

Recommended v0 resource families:

- `auth`
- `verification`
- `onboarding`
- `users`
- `profiles`
- `guilds`
- `namespaces`
- `handles`
- `posts`
- `livestreams`
- `assets`
- `feeds`
- `marketplace`
- `tracks`
- `scrobbles`
- `mpp`
- `jobs`

Interpretation:

- `auth`
  Privy-backed auth bootstrap and Pirate app-session endpoints.
- `verification`
  Self verification and other proof-driven verification session flows.
- `onboarding`
  Generated `.pirate` handle, Reddit bootstrap, interest seeding, first-guild suggestions, and onboarding status.
- `users`
  Canonical user object and account attachments.
- `profiles`
  Public/editable profile surface, including the active global `.pirate` identity.
- `guilds`
  Guild creation, settings, membership, gates, moderation roles, payout-policy selection, and creation-time policy selection.
- `namespaces`
  Root attachment state, mirrors, delegation state, and namespace-level policy surfaces.
- `handles`
  Guild-handle search, eligibility, claim, renew, revoke, and availability flows.
- `posts`
  Social write model for root posts, replies, nested votes, and moderation state.
- `livestreams`
  First-class `live_room` write model, including scheduling, lifecycle changes, anchor-post linkage, and live or replay access state.
- `assets`
  Upload-backed rights-bearing objects, analysis, Story publication, access mode, and derivative lineage.
- `feeds`
  Read-only or read-mostly discovery and guild feed surfaces.
- `marketplace`
  Listings, quote generation, purchase initiation, entitlement reads, and purchase history.
- `tracks`
  Canonical track identity, artist-catalog reads, track resolution, and preregistered catalog metadata.
- `scrobbles`
  Listen submission, scrobble reconciliation, and listen-derived read views.
- `mpp`
  Machine-access payment-gated surfaces for exports, search, and bulk retrieval.
- `jobs`
  Async workflow inspection where the client needs status polling.

Important nested surfaces:

- votes are nested under `posts` in v0
- moderation is nested under `guilds` and `posts`
- membership is nested under `guilds`
- payout policy is nested under `guilds`
- gate rules are nested under `guilds`
- questions are nested under `guilds` and `posts`
- karaoke remains nested under `assets` and song-post read models rather than becoming a top-level API family
- royalty-graph reads are nested under `assets`
- global `.pirate` handle lifecycle belongs under `profiles` or `users`, not guild `handles`

Important control-plane boundary:

- web/app is the authoritative room-authoring surface in v0
- desktop/native host clients should attach to existing rooms rather than becoming the canonical creator of guild, post, listing, or donation state
- room creation is a control-plane operation; host-attach and guest-attach are performance-plane operations
- broadcast credentials are issued at host-attach time, not at room creation time

Important product boundary:

- normal human browsing and app use should not require MPP payment
- MPP belongs on explicit machine or bulk-access surfaces, not ordinary thread and feed reads

## Design Principles

### Stable IDs Everywhere

The API should use opaque canonical IDs, not route-derived labels or wallet addresses.

Examples:

- `user_id`
- `guild_id`
- `namespace_id`
- `guild_handle_id`
- `post_id`
- `live_room_id`
- `question_id`
- `asset_id`
- `track_id`
- `listing_id`
- `purchase_id`

### Action-Time Enforcement

Sensitive actions should be checked when the action happens, not only when the page loaded.

This includes:

- guild gate checks
- handle eligibility
- vote eligibility
- `18+` access checks
- locked asset entitlement checks

### Async-First For Expensive Work

Any workflow that depends on external systems, large media, or chain settlement should expose a job-like lifecycle.

Recommended v0 stance:

- resource lifecycle fields remain authoritative on the parent resource
- `/jobs` exists for pollable long-running workflows
- verification sessions are first-class verification records, not generic jobs

### Read Models Are Allowed

Feeds, public profiles, guild pages, and asset detail pages may use denormalized read models.

The existence of those read models does not change the canonical domain object ownership defined in the domain specs.

## Write Model vs Read Model

### Write Model

The write model is the authoritative application state.

Examples:

- create guild
- attach namespace
- claim handle
- create post
- create live room
- attach or create asset
- publish asset to Story
- create listing
- submit purchase intent
- record scrobble

### Read Model

The read model is optimized for UI surfaces.

Examples:

- `Home`
- `Your Guilds`
- public profile pages
- guild landing pages
- handle availability/search results
- asset detail pages
- live room detail pages
- purchase history
- track detail pages
- scrobble leaderboards or listener views

Rules:

- read models may denormalize from multiple domain objects
- read models may include derived labels like `display_handle`
- read models may include cached gate or eligibility hints for UX
- authoritative enforcement still happens at action time against the write model and current proofs/entitlements
- machine-access surfaces may expose separate export or search-oriented read models under MPP policy

## Authentication And Identity

Recommended v0 assumptions:

- auth starts from a Privy-backed proof
- Pirate issues its own app session after Privy authentication succeeds
- domain identity is `user_id`
- wallet addresses are attachments, not canonical IDs
- Self verification status is checked from Pirate's verification model

Important rule:

- no core write endpoint should key identity by raw wallet address alone

## Verification Surface

The API should expose verification as explicit workflows, not hidden side effects.

Key v0 flows:

- start Self verification
- inspect Self verification session
- complete or refresh Self verification state
- start Reddit verification through onboarding or verification
- check Reddit verification result
- trigger Reddit snapshot import
- inspect external trust snapshot status

Verification outcomes should be visible to the client as:

- immediate success or failure
- or an async job/session status if the process is not instant

Recommended v0 boundary:

- Self verification sessions stay under the verification or user model
- Reddit bootstrap stays under onboarding, even if some endpoints are also grouped under verification in the API

## Async Job Model

Recommended v0 job-backed workflows:

- Reddit snapshot import
- media analysis
- Story publication
- routed-funding purchase settlement confirmation
- locked asset access materialization where needed

Suggested v0 job fields:

- `job_id`
- `job_type`
- `status`
- `subject_type`
- `subject_id`
- `result_ref` nullable
- `error_code` nullable
- `created_at`
- `updated_at`

Suggested `status` values:

- `queued`
- `running`
- `succeeded`
- `failed`

Suggested `job_type` examples:

- `reddit_snapshot_import`
- `media_analysis`
- `story_publication`
- `purchase_settlement_confirmation`
- `entitlement_grant`
- `artist_metadata_enrichment`
- `track_reconciliation`
- `catalog_track_preregistration`
- `replay_processing`

Rules:

- async jobs should be inspectable by the subject user or an authorized moderator/admin
- clients should not need to guess whether a flow is still processing
- the parent resource remains the source of truth for lifecycle status
- jobs are for progress and polling, not for replacing parent lifecycle fields

## Core Flow Boundaries

### Onboarding

Recommended API shape:

1. create or resume session
2. return generated `.pirate` handle
3. optionally rename global handle
4. optionally verify Reddit
5. optionally trigger Reddit snapshot import job
6. optionally join suggested guilds

Recommended v0 implementation posture:

- auth bootstrap and onboarding do not need a dedicated onboarding-session resource
- a normal authenticated app session plus onboarding status is sufficient in v0

### Guild Creation

Recommended API shape:

1. create guild request
2. prove root ownership
3. choose namespace handle policy template or custom policy
4. create guild, namespace, handle policy, and default karma policy together
5. optionally enqueue artist metadata enrichment when the guild is artist-linked
6. optionally attach delegation or governance later

Recommended v0 stance:

- use one final `POST /guilds` write once prerequisites are satisfied
- root-proof and validation steps may happen before that final write
- v0 does not need a separate guild-creation session resource

### Handle Claim

Recommended API shape:

1. resolve current namespace policy
2. check membership and gate eligibility
3. check trust/karma eligibility if required
4. check availability
5. require anti-bot challenge only where policy says it applies
6. create claim or purchase result
7. update the active namespace-local identity

Global `.pirate` handle changes follow a different surface:

- generated global handle at signup
- free cleanup rename during onboarding or early account setup
- later paid upgrades through profile or user-owned identity endpoints

### Questions

Recommended API shape:

1. inspect current daily question state for the guild
2. publish or schedule a guild-agent question when enabled
3. submit one answer per user
4. reveal or close the question
5. emit any resulting karma event asynchronously

Recommended v0 stance:

- questions stay nested under guild or post surfaces rather than becoming a top-level API family
- the guild agent is an app-level actor referenced by the guild record
- answer submission and reward state should be inspectable without creating a separate study-product API

### Livestream Creation And Room Lifecycle

Recommended API shape:

1. authorized actor creates a `live_room` on web/app (control plane)
2. Pirate creates or attaches the anchor post used for feed and discussion
3. if the room is paid, the room references the active listing or later receives one
4. host client (desktop or native) calls host-attach to receive broadcast credentials
5. host starts the room, transitioning it from `scheduled` to `live`
6. host or moderator ends or cancels the room
7. replay linkage may be attached later without changing the room into a separate replay-only type

Recommended v0 stance:

- livestreams are first-class room objects, not `post_type` variants
- the anchor post is the social container, not the source of truth for room lifecycle
- paid live and replay access should reuse the normal listing and entitlement model
- room creation and scheduling should happen on web/app control-plane surfaces first
- desktop/native host clients should consume existing `live_room` state and host credentials rather than defining the canonical room object themselves
- karaoke remains an asset capability rather than a sibling room family

Host attach and credential handoff:

- `POST /live-rooms/{live_room_id}/host-attach` — called by the desktop or native host client after the room is created on the control plane; returns bridge token, Agora channel, broadcaster token, and broadcast handoff parameters
- host-attach is idempotent for a given host session: calling it again returns the same or refreshed credentials
- broadcast infrastructure is provisioned at host-attach time, not at room creation time; `broadcast_ref` is null until the host attaches
- in old Pirate, desktop created the room and called `/live/:id/start` directly; v2 splits creation (control plane) from host-attach (performance plane)

Guest attach (duet rooms):

- `POST /live-rooms/{live_room_id}/guest-attach` — called by an invited collaborator after the host has started the room; returns guest broadcast credentials
- guest attach is only valid for rooms with `room_kind: duet` where the caller matches `guest_user_id`
- cancellation or host-ending a room invalidates all guest credentials

Old Pirate API surfaces that are replaced by the handoff model:

- `POST /live/create` (desktop direct creation) → `POST /live-rooms` (web/app control plane)
- `POST /live/:id/start` combined with bridge-ticket generation → `POST /live-rooms/{id}/host-attach` then `POST /live-rooms/{id}/start`
- `POST /live/:id/bridge/token` → subsumed by host-attach response
- `GET /live/:id/public-info` → `GET /live-rooms/{id}` on the read surface

Commerce fields moved off the room object:

- old Pirate stored `live_amount`, `replay_amount`, `payment_asset`, `split_address`, `network` directly on the room
- v2 moves all pricing and payout routing to `listing_id` and `replay_listing_id` on the room, with the actual commerce details on the listing
- settlement tracking is a known deferred gap for live; v0 can rely on marketplace purchase and entitlement records

### Post And Asset Creation

Recommended API shape:

1. upload or register media reference
2. create media analysis job
3. poll analysis result
4. if allowed, create post
5. optionally create/attach asset
6. optionally create Story publication job
7. optionally attach derivative or royalty-graph references

Important rule:

- uploads with blocking analysis outcomes must not produce a normally publishable post

### Marketplace Purchase

Recommended API shape:

1. fetch listing
2. request quote
3. resolve regional pricing if applicable
4. create purchase intent
5. client funds purchase through supported flow
6. settlement confirmation job resolves
7. purchase record becomes canonical
8. buyer entitlement becomes readable

### Scrobbling

Recommended API shape:

1. resolve or register track identity
2. submit scrobble directly or through trusted delegated path
3. record offchain reference and/or onchain submission state
4. update read models and karma derivations asynchronously if needed

Recommended URL posture:

- track identity and scrobble submission are separate concerns
- direct and delegated submissions may share one resource with a `submission_mode` field in v0

## Enforcement Boundaries

The API should make enforcement points explicit.

### Voting

- voter must be Self-verified
- nullifier uniqueness must still be valid
- rate limits and anti-abuse rules still apply
- CAPTCHA must not be required for normal verified-user voting in v0
- votes should be nested under `posts` in v0 rather than exposed as a top-level API family

### Guild Gates

- membership gates apply at join time
- viewer gates apply at read time for gated surfaces
- posting gates apply at post creation time

### `18+` Access

- viewer eligibility must be checked from current verification state
- stale cached booleans are not sufficient

### Locked Assets

- feed preview may remain visible
- full payload access must be checked against the current asset access and entitlement state

### Moderation And Membership

- moderation write surfaces should stay nested under the relevant guild or post
- membership actions such as join or leave should stay nested under the relevant guild

## Error Model

The OpenAPI layer should eventually standardize errors into a small set of categories.

Recommended categories:

- `auth_error`
- `payment_required`
- `verification_required`
- `eligibility_failed`
- `gate_failed`
- `analysis_blocked`
- `analysis_review_required`
- `conflict`
- `not_found`
- `rate_limited`
- `payment_failed`
- `settlement_pending`
- `internal_error`

Rules:

- error responses should prefer stable machine-readable codes
- policy-driven failures should explain whether the issue is retryable, permanent, or review-bound

## Versioning

Recommended v0 posture:

- one versioned API surface
- additive changes preferred
- breaking changes should wait for explicit version bumps

The OpenAPI file should reflect this once endpoint work begins.

## Relationship To OpenAPI

This doc should be treated as the boundary document for the first `openapi.yaml`.

Recommended next step:

- encode the happy-path v0 endpoints first
- leave later governance and advanced marketplace behaviors out until they are truly needed

## Open Questions

- Which flows deserve websocket or push updates in v0 versus plain polling?
- Should scrobble submission be synchronous app acknowledgement with async chain reconciliation, or should the API expose both direct and delegated submission modes separately?
