# Scrobbles

Status: current working spec

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [artist-catalog.md](./artist-catalog.md)
- [karma.md](./karma.md)
- [feed.md](./feed.md)
- [../contracts/overview.md](../contracts/overview.md)

## Purpose

This doc defines Pirate's music-listening event model.

It covers:

- track identity
- scrobble submission
- trusted delegated ingestion
- relationship to communities and assets
- relationship to karma
- onchain versus offchain boundaries

## Non-goals

This doc does not define:

- exact onchain ABI for the Story-side scrobble contract
- final desktop or player SDK details
- exact listen-validity thresholds
- playlist or library product features

## Core Principle

Scrobbles are canonical listen events, not just analytics logs.

They should be:

- attributable to a user
- attributable to a track
- attributable to a club context when one exists
- cheap to publish
- harder to fake than ordinary app telemetry

Aggregation, ranking, and read views may stay offchain, but the event itself is meaningful product state.

## Track Identity

Scrobbles must point to a stable track identifier.

The canonical v0 track model lives in [artist-catalog.md](./artist-catalog.md).

Scrobble flows should reuse that same `track_id`, not define a second competing track schema.

Important v0 track properties for scrobbling are:

- `track_id`
- `track_kind`
- `recording_mbid` nullable
- `story_ip_id` nullable
- `asset_id` nullable
- `community_id` nullable
- `title`
- `artist_display_name`
- `duration_ms` nullable
- `status`

Rules:

- `track_id` is Pirate's stable canonical track identifier for scrobbling
- a track may point to an `asset_id` when it corresponds to a Pirate asset
- a track may exist without a Pirate asset when Pirate needs to scrobble external or imported music references
- `community_id` is nullable because a track may be globally known before it is strongly attached to one club
- `artist_display_name` is a denormalized read convenience, not the canonical artist-identity linkage

## Relationship To Assets

When a song asset exists, the track and asset should be linked.

Recommended v0 rules:

- one `song` asset may map to one canonical `track_id`
- scrobble flows should prefer the canonical linked `track_id` rather than re-registering duplicate track identities
- derivative assets may map to distinct tracks even when they reference the same upstream song lineage

## Scrobble Event Model

Suggested v0 public scrobble shape:

- `scrobble_id`
- `track_id`
- `user_id`
- `community_id` nullable
- `source_type`
- `playback_started_at`
- `playback_position_ms` nullable
- `credited_duration_ms` nullable
- `ingestion_mode`
- `idempotency_key`
- `anchor_status`
- `accepted_at`
- `anchored_at` nullable
- `chain_tx_hash` nullable
- `chain_log_index` nullable
- `created_at`

Suggested meanings:

- `source_type`
  - `web`
  - `desktop`
  - `mobile`
  - `operator_ingested`
- `ingestion_mode`
  - `first_party`
  - `trusted_import`
- `anchor_status`
  - `queued`
  - `awaiting_wallet`
  - `awaiting_track`
  - `anchoring`
  - `anchored`
  - `failed`
  - `suppressed`

Rules:

- a scrobble records a listen event, not a vote
- a scrobble belongs to exactly one `track_id`
- a scrobble belongs to exactly one `user_id`
- `community_id` is nullable because some listens may happen outside an explicit club surface
- `credited_duration_ms` is the listen amount Pirate accepts for validity and karma purposes
- `created_at` is the row timestamp; `accepted_at` is the canonical product timestamp for successful ingest acceptance
- `chain_tx_hash` plus `chain_log_index` identify the anchored onchain event when anchoring succeeds
- `submission_mode` is not part of the public domain model; it remains a contract/event concept only

## Listen Validity

Not every playback ping should become a scrobble.

Recommended v0 rules:

- only listens that pass minimum validity thresholds produce canonical scrobbles
- validity should consider credited duration, track duration, and anti-replay heuristics
- repeated instant-replay or obviously synthetic patterns may be rejected or ignored
- validity is checked at ingest time, not at anchor time
- invalid scrobbles are rejected synchronously and never enter the anchor queue

The exact thresholds are implementation policy, not protocol.

## Ingestion Provenance

Pirate distinguishes offchain ingestion provenance from onchain submission mode.

### First-Party Ingestion

First-party ingestion means a Pirate client submits a scrobble in the normal authenticated product flow.

Examples:

- Pirate web player
- Pirate mobile player

### Trusted Import

Trusted import means Pirate accepts a scrobble through a trusted ingestion path that later resolves into the same canonical scrobble model.

Examples:

- desktop scrobbling bridge
- trusted operator path for external player integrations
- bulk import tooling

Rules:

- every scrobble keeps its ingestion provenance in `ingestion_mode`
- delegated ingestion must still resolve to a concrete `user_id`
- delegated ingestion must be auditable
- delegated ingestion should not weaken anti-Sybil or anti-fraud requirements
- onchain `submissionMode` remains a contract/event-level field
- under batch publication, onchain `submissionMode` is effectively always `delegated`

## Relationship To Communities

Scrobbles may have club context.

Recommended v0 behavior:

- if a listen happens from within a community-owned song or club playback surface, the scrobble may carry that `community_id`
- the same user may scrobble the same track in different club contexts over time
- community-scoped scrobbles are useful for local listener recognition and community karma derivation

## Relationship To Karma

Scrobbles may contribute to karma, but only weakly and with caps.

Canonical rules live in [karma.md](./karma.md).

Directional v0 rules:

- scrobbles may generate `scrobble_karma_grant` events after anchoring
- scrobble karma is capped per `(user_id, community_id)` per day
- scrobble karma alone must not dominate handle eligibility

## Read Views

Scrobble read views are product read models built on top of canonical scrobble events.

Examples:

- top listeners for a track
- recent listeners in a club
- user listening history
- club charts
- artist/club fan recognition

These are read models, not new canonical event types.

## On-chain vs Off-chain

Recommended v0 split:

- accepted offchain rows are the canonical ingest records
- anchored onchain events are the canonical anchor records
- canonical scrobble publication should use the Story-side scrobble contract
- track registration should have a Story-side contract surface
- app-level services may still keep mirrored offchain references for read performance, recovery, and product indexing
- ranking, charts, streaks, and club summaries remain offchain read models
- product features that require freshness may read accepted scrobbles
- product features that require irreversibility must depend on anchored scrobbles

## Wallet Resolution

Scrobble anchoring requires a resolved EIP-155 wallet address. See [user.md](./user.md) under Scrobble Wallet Resolution.

Rules:

- if no active EIP-155 wallet exists, the scrobble enters `anchor_status = awaiting_wallet`
- wallet resolution is pinned at ingest time
- the anchor worker may re-resolve and update the pin if the pinned wallet is revoked before anchor

## Ordering And Idempotency

Rules:

- `playback_started_at` is the canonical event timestamp
- batch item order is not semantically meaningful
- each scrobble carries an `idempotency_key` unique per user per source
- duplicate keys from retries must not produce duplicate ingest events
- two scrobbles from the same user may share the same `playback_started_at` if they are distinct events; the idempotency key disambiguates retries from legitimate duplicates

## API Implications

Likely v0 API surfaces:

- create or resolve track identity
- submit scrobble
- inspect scrobble status or reconciliation state
- read listener and track summaries

Recommended URL posture for v0:

- `POST /tracks`
- `GET /tracks/{track_id}`
- `POST /scrobbles`
- `GET /users/{user_id}/scrobbles`
- `GET /tracks/{track_id}/listeners`

The exact OpenAPI paths can stay flexible, but the separation between track identity and scrobble events should remain.

## Open Questions

- What exact listen-validity threshold should convert playback into a canonical scrobble?
- Should `community_id` be required for community-owned song surfaces, or may some listens remain globally scoped even there?
