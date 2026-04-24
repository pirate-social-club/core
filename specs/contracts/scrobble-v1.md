# Scrobble V1

Status: active reference

Related docs:

- [overview.md](./overview.md)
- [../domain/scrobbles.md](../domain/scrobbles.md)

## Purpose

This doc defines the minimal Story-side scrobble contract for Pirate.

It covers:

- canonical track registration
- canonical scrobble publication
- direct and delegated submission
- explicit non-goals for v1

## Core Principle

The contract should publish canonical music listening events while staying narrow.

It should not become a general-purpose music metadata registry, playlist system, or ranking engine.

## Contract Role

`ScrobbleV1` is responsible for:

- registering canonical `track_id` values before use
- preventing scrobbles for unknown tracks
- emitting canonical scrobble events
- supporting direct user submission
- supporting trusted operator-assisted submission

In Pirate, the normal production path is delegated batch anchoring:

1. the API accepts a scrobble offchain
2. the anchor worker ensures referenced tracks are registered
3. an authorized operator publishes `scrobbleBatch(...)` on behalf of the resolved user wallet

`ScrobbleV1` is not responsible for:

- anti-fraud heuristics
- charting or streaks
- karma calculation
- playlist state
- full track metadata storage
- lyrics, covers, or presentation refs

Those remain offchain read-model or application concerns.

## Track Registry

Recommended v1 storage:

- `track_id -> Track`

Suggested `Track` shape:

- `metadata_hash`
- `registered_at`
- `exists`

Rules:

- `track_id` is Pirate's canonical stable track identifier
- the contract does not interpret how `track_id` was derived
- `metadata_hash` is an offchain integrity anchor for the app-side track record
- full track metadata stays offchain
- a track must be registered before it can be scrobbled

## Submission Model

Recommended v1 auth split:

- `owner`
  - manages operators
- `operator`
  - registers tracks
  - submits delegated scrobbles
- `user`
  - may submit direct scrobbles for self

Rules:

- direct path: `msg.sender == user`
- delegated path: `msg.sender` is an authorized operator
- delegated submission must still name the concrete `user` whose listen is being recorded
- batch publication requires the operator to hold `isOperator(...)` on `ScrobbleV1`
- `scrobbleBatch(...)` accepts one `user` per call, so the batch publisher must group queued scrobbles by resolved wallet address

## Event Model

Recommended v1 event:

- `user`
- `track_id`
- `club_id`
- `playback_started_at`
- `credited_duration_ms`
- `source_type`
- `submission_mode`

Semantics:

- `club_id = bytes32(0)` means no club context
- `credited_duration_ms` is the only listen-duration field carried onchain in v1
- `playback_position_ms` is intentionally omitted from v1 because it is not required for canonical event identity
- under Pirate batch anchoring, `submission_mode` reflects the chain submitter path, not the original app-side provenance
- this means batch-published scrobbles normally emit `submission_mode = delegated`

## Enums

Recommended closed enum values:

- `source_type`
  - `1 = web`
  - `2 = desktop`
  - `3 = mobile`
  - `4 = operator`
- `submission_mode`
  - `1 = direct`
  - `2 = delegated`

The contract should reject unknown enum values rather than emitting ambiguous events.

## Batching

Recommended v1 behavior:

- support single and batch registration
- support single and batch scrobbling
- cap batch size to a fixed upper bound
- require tracks to exist before scrobbling
- keep registration and scrobble publication as separate transactions in v1

Initial v1 constant:

- `MAX_BATCH = 200`

Operational constraints for Pirate:

- `registerTracks(...)` and `scrobbleBatch(...)` are separate transactions
- if a track in `registerTracks(...)` already exists, the entire transaction reverts
- if a track in `scrobbleBatch(...)` is missing, the entire transaction reverts
- the batch publisher must verify registration status offchain before submitting either call
- there is an inherent TOCTOU race: another process may register the same track between the offchain check and the onchain submission
- the publisher should catch `TrackAlreadyRegistered` and treat it as successful concurrent registration, then retry the scrobble batch
- registration may succeed before the corresponding scrobbles anchor; backend reconciliation is responsible for retrying scrobble publication safely

## Non-Goals

`ScrobbleV1` should not include:

- onchain validity scoring
- replay detection
- streak accounting
- playlist writes
- lyrics refs
- cover refs
- publisher/title/album strings
- user-facing combined register-and-scrobble methods

Those may exist in application services or later contract versions if they become materially necessary.

Future-contract note:

- an operator-only combined register-and-scrobble helper may be considered as a gas optimization in a future v2 contract
- it is out of scope for `ScrobbleV1`
- it should not be exposed as a direct user-submission path
