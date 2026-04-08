# Scrobbles

Status: draft

Related docs:

- [guild.md](./guild.md)
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
- relationship to guilds and assets
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
- attributable to a guild context when one exists
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
- `guild_id` nullable
- `title`
- `artist_display_name`
- `duration_ms` nullable
- `audio_fingerprint_ref` nullable
- `status`

Rules:

- `track_id` is Pirate's stable canonical track identifier for scrobbling
- a track may point to an `asset_id` when it corresponds to a Pirate asset
- a track may exist without a Pirate asset when Pirate needs to scrobble external or imported music references
- `guild_id` is nullable because a track may be globally known before it is strongly attached to one guild
- `artist_display_name` is a denormalized read convenience, not the canonical artist-identity linkage
- `audio_fingerprint_ref` is an optional enrichment or reconciliation aid, not the primary track identity

## Relationship To Assets

When a song asset exists, the track and asset should be linked.

Recommended v0 rules:

- one `song` asset may map to one canonical `track_id`
- scrobble flows should prefer the canonical linked `track_id` rather than re-registering duplicate track identities
- derivative assets may map to distinct tracks even when they reference the same upstream song lineage

## Scrobble Event Model

Suggested v0 scrobble shape:

- `scrobble_id`
- `track_id`
- `user_id`
- `guild_id` nullable
- `source_type`
- `playback_started_at`
- `playback_position_ms` nullable
- `credited_duration_ms` nullable
- `submission_mode`
- `chain_tx_ref` nullable
- `created_at`

Suggested meanings:

- `source_type`
  - `web`
  - `desktop`
  - `mobile`
  - `operator_ingested`
- `submission_mode`
  - `direct`
  - `delegated`

Rules:

- a scrobble records a listen event, not a vote
- a scrobble belongs to exactly one `track_id`
- a scrobble belongs to exactly one `user_id`
- `guild_id` is nullable because some listens may happen outside an explicit guild surface
- `credited_duration_ms` is the listen amount Pirate accepts for validity and karma purposes

## Listen Validity

Not every playback ping should become a scrobble.

Recommended v0 rules:

- only listens that pass minimum validity thresholds produce canonical scrobbles
- validity should consider credited duration, track duration, and anti-replay heuristics
- repeated instant-replay or obviously synthetic patterns may be rejected or ignored

The exact thresholds are implementation policy, not protocol.

## Submission Modes

### Direct

Direct submission means the app or player submits a scrobble on behalf of the authenticated user in the normal product flow.

Examples:

- Pirate web player
- Pirate mobile player

### Delegated

Delegated submission means Pirate accepts a trusted ingestion path that later resolves into a canonical scrobble.

Examples:

- desktop scrobbling bridge
- trusted operator path for external player integrations

Rules:

- delegated ingestion must still resolve to a concrete `user_id`
- delegated ingestion must be auditable
- delegated ingestion should not weaken anti-Sybil or anti-fraud requirements

## Relationship To Guilds

Scrobbles may have guild context.

Recommended v0 behavior:

- if a listen happens from within a guild-owned song or guild playback surface, the scrobble may carry that `guild_id`
- the same user may scrobble the same track in different guild contexts over time
- guild-scoped scrobbles are useful for local listener recognition and guild karma derivation

## Relationship To Karma

Scrobbles may contribute to karma, but only weakly and with caps.

Canonical rules live in [karma.md](./karma.md).

Directional v0 rules:

- scrobbles may generate `scrobble_karma_grant` events
- scrobble karma is capped per `(user_id, guild_id)` per day
- scrobble karma alone must not dominate handle eligibility

## Read Views

Scrobble read views are product read models built on top of canonical scrobble events.

Examples:

- top listeners for a track
- recent listeners in a guild
- user listening history
- guild charts
- artist/guild fan recognition

These are read models, not new canonical event types.

## On-chain vs Off-chain

Recommended v0 split:

- canonical scrobble publication should use the Story-side scrobble contract
- track registration should have a Story-side contract surface
- app-level services may still keep mirrored offchain references for read performance, recovery, and product indexing
- ranking, charts, streaks, and guild summaries remain offchain read models

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
- Should desktop scrobbles always be delegated submissions, or can some clients submit directly?
- Should `guild_id` be required for guild-owned song surfaces, or may some listens remain globally scoped even there?
