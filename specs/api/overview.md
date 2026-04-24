# API Overview

Status: active reference

Related docs:

- [./mpp.md](./mpp.md)
- [../domain/user.md](../domain/user.md)
- [../domain/profile.md](../domain/profile.md)
- [../domain/onboarding.md](../domain/onboarding.md)
- [../domain/community.md](../domain/community.md)
- [../domain/artist-catalog.md](../domain/artist-catalog.md)
- [../domain/namespace.md](../domain/namespace.md)
- [../domain/handles.md](../domain/handles.md)
- [../domain/post.md](../domain/post.md)
- [../domain/livestream.md](../domain/livestream.md)
- [../domain/replay.md](../domain/replay.md)
- [../domain/live-segments.md](../domain/live-segments.md)
- [../domain/karaoke.md](../domain/karaoke.md)
- [../domain/performance.md](../domain/performance.md)
- [../domain/asset.md](../domain/asset.md)
- [../domain/feed.md](../domain/feed.md)
- [../domain/marketplace.md](../domain/marketplace.md)
- [../domain/monetization.md](../domain/monetization.md)
- [../domain/royalty-graph.md](../domain/royalty-graph.md)
- [../domain/rights-review.md](../domain/rights-review.md)
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
The read model should optimize for product surfaces such as feeds, profiles, and community pages.

## API Families

Recommended v0 resource families:

- `auth`
- `verification`
- `onboarding`
- `users`
- `profiles`
- `communities`
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
  Provider-driven verification session flows.
- `onboarding`
  Generated `.pirate` handle, Reddit bootstrap, interest seeding, first-club suggestions, and onboarding status.
- `users`
  Canonical user object and account attachments.
- `profiles`
  Public/editable profile surface, including the active global `.pirate` identity.
- `communities`
  Community creation, settings, membership, gates, moderation roles, payout-policy selection, and creation-time community bootstrap such as labels, rules, and resource links.
- `namespaces`
  Root attachment state, mirrors, delegation state, and namespace-level policy surfaces.
- `handles`
  Community-handle search, eligibility, claim, renew, revoke, and availability flows.
- `posts`
  Social write model for root posts, replies, nested votes and reactions, and moderation state.
- `livestreams`
  First-class `live_room` write model, including scheduling, lifecycle changes, anchor-post linkage, and live or replay access state.
- `assets`
  Upload-backed rights-bearing objects, analysis, Story publication, access mode, and derivative lineage.
- `feeds`
  Read-only or read-mostly discovery and community feed surfaces.
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

- votes and reactions are nested under `posts` in v0
- moderation is nested under `communities` and `posts`
- membership is nested under `communities`
- payout policy is nested under `communities`
- gate rules are nested under `communities`
- questions are nested under `communities` and `posts`
- karaoke remains nested under `assets` and song-post read models rather than becoming a top-level API family
- royalty-graph reads are nested under `assets`
- global `.pirate` handle lifecycle belongs under `profiles` or `users`, not club `handles`

Important control-plane boundary:

- web/app is the authoritative room-authoring surface in v0
- desktop/native host clients should attach to existing rooms rather than becoming the canonical creator of club, post, listing, or donation state
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
- `community_id`
- `namespace_id`
- `club_handle_id`
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

- community gate checks
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

Feeds, public profiles, community pages, and asset detail pages may use denormalized read models.

The existence of those read models does not change the canonical domain object ownership defined in the domain specs.

## Write Model vs Read Model

### Write Model

The write model is the authoritative application state.

Examples:

- create club
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
- `Your Communities`
- public profile pages
- club landing pages
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
- a future human CLI flow should use browser handoff or device-code-style approval and then land on the same Pirate app session model
- domain identity is `user_id`
- wallet addresses are attachments, not canonical IDs
- verification status is checked from Pirate's provider-neutral verification model
- Privy wallet provisioning and auth are client-facing concerns; Story chain execution remains operator-driven and independent of Privy relay or sponsorship infrastructure

Important rule:

- no core write endpoint should key identity by raw wallet address alone

## Verification Surface

The API should expose verification as explicit workflows, not hidden side effects.

Key v0 flows:

- start verification session
- inspect verification session
- complete or refresh verification state
- get current wallet-score capability
- refresh wallet-score capability
- start HNS namespace verification session
- inspect HNS namespace verification session
- complete or refresh HNS namespace verification after TXT publication
- inspect accepted namespace verification by `namespace_verification_id`
- start Reddit verification through onboarding or verification
- check Reddit verification result
- trigger Reddit snapshot import
- inspect external trust snapshot status

Verification outcomes should be visible to the client as:

- immediate success or failure
- or an async job/session status if the process is not instant

Recommended v0 boundary:

- interactive verification sessions stay under the verification or user model and are used for providers such as `self` and `very`
- Human Passport `wallet_score` remains under the verification surface, but as a server-side read/refresh capability flow rather than an interactive session
- namespace verification sessions may live under verification or a dedicated namespace-verification surface, but they must remain explicit session workflows rather than hidden preflights
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
6. optionally join suggested communities

Recommended v0 implementation posture:

- auth bootstrap and onboarding do not need a dedicated onboarding-session resource
- a normal authenticated app session plus onboarding status is sufficient in v0

### Community Creation

Recommended API shape:

1. complete namespace verification and obtain `namespace_verification_id`
2. choose membership mode (`open` or `gated`) plus a namespace handle policy template or custom policy, defaulting new public communities to `standard`
3. submit one final create request referencing the accepted namespace verification
4. server re-checks creator binding, freshness, and `club_attach_allowed` on the accepted verification object
5. create club, namespace, handle policy, and default karma policy together
6. optionally include initial community bootstrap such as label definitions, rules, and resource links for internal or later clients
7. optionally enqueue artist metadata enrichment when the club is artist-linked
8. optionally attach delegation or governance later
9. optionally configure authenticity policy, authenticity-detection profile selection, and source policy during post-create onboarding or later community settings; if omitted, the server enforces restrictive defaults and the platform-default detection profile from the first post onward

Recommended v0 stance:

- use one final `POST /communities` write once prerequisites are satisfied
- root-proof and validation steps happen before that final write through namespace verification
- `POST /communities` must consume the accepted namespace-verification object referenced by `namespace_verification_id`, not just trust the field's presence
- v0 does not need a separate club-creation session resource
- community bootstrap may share the same write in broader API shape, but it is deferred from the public v0 client
- authenticity and source policy are also deferred from the public v0 create client; omission must not mean "no rules" and must not block the community from becoming active
- authenticity-detection profile selection is likewise deferred from the public v0 create client; omission means the platform-default profile applies, not that authenticity detection is disabled
- the initial handle-policy record does not imply public handle claims or namespace commerce are live; new public communities should begin with claims and sales disabled, then unlock later capabilities from derived community stage plus namespace/governance prerequisites

### Handle Claim

Recommended API shape:

1. resolve current namespace policy
2. verify that namespace capabilities and derived community-stage permissions allow claims
3. check membership and gate eligibility
4. check trust/karma eligibility if required
5. check availability
6. require anti-bot challenge only where policy says it applies
7. create claim or purchase result
8. update the active namespace-local identity

Global `.pirate` handle changes follow a different surface:

- generated global handle at signup
- free cleanup rename during onboarding or early account setup
- later paid upgrades through profile or user-owned identity endpoints

### Questions

Recommended API shape:

1. inspect current daily question state for the club
2. publish or schedule a club-agent question when enabled
3. submit one answer per user
4. reveal or close the question
5. emit any resulting karma event asynchronously

Recommended v0 stance:

- questions stay nested under club or post surfaces rather than becoming a top-level API family
- the community agent is an app-level actor referenced by the club record
- answer submission and reward state should be inspectable without creating a separate study-product API

### Livestream Creation And Room Lifecycle

Recommended API shape:

1. authorized actor uses the composer on web/app to create a live-mode draft
2. the create request includes room metadata plus the initial setlist payload
3. Pirate creates the `live_room` and the anchor post together
4. if the room is paid, the room references the active listing or later receives one
5. host client (desktop or native) calls host-attach to receive broadcast credentials
6. host starts the room, transitioning it from `scheduled` to `live`
7. host or moderator ends or cancels the room
8. replay linkage may be attached later without changing the room into a separate replay-only type

Recommended v0 stance:

- livestreams are first-class room objects, not `post_type` variants
- the anchor post is the social container, not the source of truth for room lifecycle
- paid live and replay access should reuse the normal listing and entitlement model
- room creation and scheduling should happen through the composer on web/app first
- the backend create-room path should require an initial setlist payload
- the backend create-room path should also require explicit performer allocations
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

### Live Setlists And Segments

Recommended API shape:

1. host creates the room with an initial setlist payload
2. host may batch-edit, reorder, or add surprise songs while the room is live
3. host starts and ends segments as songs change
4. ACRCloud and replay analysis verify or discover songs after the fact
5. Pirate reconciles declared setlist items with detected tracks
6. replay publication waits until all relevant segments are sufficiently clear

Recommended v0 stance:

- an initial setlist should be present at room creation time
- room start should require an active setlist
- one room may contain many song segments
- batch setlist updates are preferred to item-by-item CRUD
- segment outcomes drive replay clearance, not just raw room state
- setlist item authoring should default to canonical track search, with manual text entry only as fallback
- the create flow should not ask the host to classify a live setlist item as `original`, `cover`, `remix`, or `dj_playback`; that context should come from the canonical track and later review surfaces

### Replay Read And Access

Recommended API shape:

1. client reads the room or anchor-post replay state after the room ends
2. if replay is `processing`, client shows a replay-processing state
3. if replay is `review_pending`, client shows an under-review state without exposing operator detail
4. if replay is `published`, client inspects replay access
5. if replay is free or included, client plays replay
6. if replay is separately paid, client follows the replay listing and entitlement path

Recommended v0 stance:

- replay remains nested under the live-room surface rather than becoming a separate top-level family
- the anchor post is still the main replay discovery surface
- `replay_status` is the public-facing lifecycle signal
- `replay_asset_id` alone does not imply public availability

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
2. submit scrobble; the server accepts it and queues it for async anchoring
3. the accepted offchain row becomes the canonical ingest record; the anchored onchain event becomes the canonical anchor record
4. an internal anchor worker periodically publishes batches onchain via `registerTracks(...)` then `scrobbleBatch(...)`
5. read models and karma derivations update after anchoring

Recommended URL posture:

- track identity and scrobble submission are separate concerns
- `POST /scrobbles` is the normal single-ingest path
- `POST /scrobbles/batch` is the trusted/internal bulk-ingest path
- users inspect `anchor_status` on scrobble resources rather than polling a separate anchor job

## Enforcement Boundaries

The API should make enforcement points explicit.

### Voting

- voter must have `verification_capabilities.unique_human.state = verified` from an accepted biometric/nullifier provider such as `self` or `very`
- nullifier uniqueness must still be valid
- rate limits and anti-abuse rules still apply
- CAPTCHA must not be required for normal verified-user voting in v0
- votes and reactions should be nested under `posts` in v0 rather than exposed as top-level API families

### Community Gates

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

- moderation write surfaces should stay nested under the relevant club or post
- membership actions such as join or leave should stay nested under the relevant club

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
- Should scrobble submission be synchronous app acknowledgement with async chain reconciliation, or should the API expose both direct and delegated submission modes separately? Resolved: scrobble submission is synchronous app acknowledgement with async chain reconciliation. The API accepts scrobbles and returns `202`. Onchain anchoring is performed asynchronously by a batch publisher. `ingestion_mode` preserves original provenance offchain; onchain `submissionMode` is effectively always delegated under batch publication.
