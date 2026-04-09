# Scrobble V1

Status: draft

Related docs:

- [overview.md](./overview.md)
- [../domain/scrobbles.md](../domain/scrobbles.md)

## Purpose

This doc defines the minimal Story-side scrobble contract for Pirate v2.

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

Initial v1 constant:

- `MAX_BATCH = 200`

## Non-Goals

`ScrobbleV1` should not include:

- onchain validity scoring
- replay detection
- streak accounting
- playlist writes
- lyrics refs
- cover refs
- publisher/title/album strings
- combined register-and-scrobble convenience methods

Those may exist in application services or later contract versions if they become materially necessary.
