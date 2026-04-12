# Artist Scrobble Gate Audit

Status: draft

Purpose:

- record the current architectural boundary between the Story scrobble contract and community gate enforcement
- identify what blocks an artist-scrobble-threshold community gate today
- define the recommended v1 design for adding an offchain artist activity gate without bloating the contract

Method:

- static inspection of the current workspace
- no claim here depends on unstated prior session context
- this audit does not claim runtime execution or passing tests unless explicitly stated

## Bottom Line

An artist-scrobble-threshold gate should not be implemented in the onchain scrobble contract.

The current contract is intentionally minimal and correct for its role as an anchoring surface. The correct place for this feature is the `pirate-api` community gate runtime, backed by control-plane scrobble projections.

The main blocker is not gate wiring. The main blocker is the absence of a materialized `track_id -> artist_identity_id` mapping that the gate runtime can query cheaply and consistently.

## Scrobble Contract Audit

The Story-side scrobble contract at [ScrobbleV1.sol](../../pirate-contracts/story/scrobble/src/ScrobbleV1.sol) is intentionally small:

- track registry:
  - `trackId -> (metadataHash, registeredAt)`
- listen event:
  - `Scrobbled(user, trackId, clubId, playbackStartedAt, creditedDurationMs, sourceType, submissionMode)`
- state:
  - no per-user counters
  - no per-artist counters
  - no queryable aggregate state beyond `tracks[trackId].exists`

That means the contract cannot answer:

- how many scrobbles a user has
- how many scrobbles a user has for an artist
- whether a user satisfies an artist threshold gate

This is by design, not an omission.

Verdict:

- keep the contract minimal
- do not add gate logic, per-artist counters, or membership checks to `ScrobbleV1`

## Community Gate Audit

The community gate system is currently closed around two families only:

- `identity_proof`
- `token_holding`

That closure is enforced independently at multiple layers:

- DB schema:
  - [1008_community_gate_rules.sql](../../pirate-api/db/community-template/migrations/1008_community_gate_rules.sql)
  - `CHECK (gate_family IN ('identity_proof', 'token_holding'))`
- API contract:
  - [pirate-api/services/contracts/src/index.ts](../../pirate-api/services/contracts/src/index.ts)
  - `gate_family: "token_holding" | "identity_proof"`
- normalization:
  - [community-gate-rule-normalization.ts](../../pirate-api/services/api/src/lib/communities/community-gate-rule-normalization.ts)
- evaluation:
  - [community-membership-store.ts](../../pirate-api/services/api/src/lib/communities/community-membership-store.ts)

The current evaluation path in `satisfiesCommunityGateRules(...)` has:

- AND semantics across all active rules
- a `token_holding` branch with async evaluation
- an `identity_proof` branch with capability checks
- a fail-closed path for anything else

The most fragile catch-all today is the explicit branch that treats any non-token, non-identity family as failure. In the current implementation, if a new gate family is added at the schema and type layers but this branch is not updated, the new family will silently fail every evaluation.

`GateEvaluationContext` currently carries:

- `user`
- `wallets`
- optional `tokenGateEvaluator`

It does not carry:

- scrobble aggregates
- artist identity context
- activity-gate evaluation hooks

## Critical Missing Primitive

The control-plane scrobble event store at [0003_control_plane_scrobbles.sql](../../pirate-api/db/control-plane/migrations/0003_control_plane_scrobbles.sql) stores `track_id` on each event, but not `artist_identity_id`.

I did not find a materialized catalog table in the inspected control-plane migrations that resolves:

- `track_id -> artist_identity_id`

That is the blocking data-model gap.

Existing signals suggest this mapping is expected eventually:

- job types already include `track_reconciliation`
- job types already include `artist_metadata_enrichment`

Those signals imply planned reconciliation work, but not a currently queryable primitive for gate evaluation.

Important distinction:

- community-local `communities.artist_identity_id` in [1001_community_core.sql](../../pirate-api/db/community-template/migrations/1001_community_core.sql) is the associated artist for the community itself
- it is not a per-track artist mapping for scrobble counting

Without `track_id -> artist_identity_id`, the system cannot reliably count artist scrobbles from the existing schema.

## Migration Hygiene Issue

The community-template migration directory currently contains duplicate gate-rule DDL:

- [1004_community_gate_rules.sql](../../pirate-api/db/community-template/migrations/1004_community_gate_rules.sql)
- [1008_community_gate_rules.sql](../../pirate-api/db/community-template/migrations/1008_community_gate_rules.sql)

Those files are byte-identical in the current workspace.

There is a separate migration-ordering problem in the same directory as well:

- some files reuse the same numeric prefix for different content

Those are not content duplicates. They are sequence conflicts, which make lexicographic application order ambiguous or at least misleading.

Before widening the gate-family check for a new gate family, both problems should be cleaned up:

- actual content duplication
- numeric sequence conflicts

## Token Gate Error Handling

The current token gate evaluator at [community-token-gate-runtime.ts](../../pirate-api/services/api/src/lib/communities/community-token-gate-runtime.ts) returns `false` for every failure mode, including:

- missing chain namespace
- missing RPC URL
- invalid contract address
- RPC read failures

That means infrastructure or integration failures are treated the same as genuine user ineligibility.

If an artist activity gate follows the same pattern, then:

- an indexing outage
- a control-plane DB outage
- a broken projection

would silently deny access rather than report that the system could not determine eligibility.

Recommendation:

- new activity gates should distinguish:
  - `passed`
  - `failed`
  - `indeterminate`
- the join/post runtime should surface backend failures as internal service errors, not false gate failures

## Recommended Design

Implement this as an offchain community gate in `pirate-api`.

Recommended gate shape:

```json
{
  "scope": "membership",
  "gate_family": "activity_proof",
  "gate_type": "artist_scrobble_count",
  "gate_config": {
    "artist_identity_id": "art_...",
    "min_scrobbles": 25,
    "window_days": null,
    "count_scope": "global",
    "count_basis": "anchored_only"
  }
}
```

Recommended semantics:

- `artist_identity_id`:
  - required
  - do not key on artist display name
- `min_scrobbles`:
  - required
  - integer `>= 1`
- `window_days`:
  - `null` means lifetime count
  - otherwise evaluate over a rolling window
- `count_scope`:
  - required product decision
  - should be explicit rather than implicit
  - likely values:
    - `global`
    - `community_local`
- `count_basis`:
  - should not reuse `anchor_status` because the scrobble table does not have an `accepted` status
  - recommended explicit values:
    - `anchored_only`
    - `non_suppressed`
  - if the backend wants an acceptance-oriented definition, tie it to a concrete predicate such as `accepted_at IS NOT NULL`, not an invented status name

Counting semantics also need an explicit product decision:

- count raw listen events, where repeated listens of the same track all count
- or count distinct tracks per artist

The current schema naturally supports event counting. Distinct-track counting is a different aggregate and should not be implied accidentally.

## Ordered Implementation Plan

### 1. Add a canonical track-to-artist projection

Create a control-plane table or materialized projection that resolves:

- `track_id -> artist_identity_id`

It should be owned by the existing track reconciliation / artist enrichment pipeline, not by the community runtime.

### 2. Add a user artist scrobble aggregate

Create a projection for fast gate evaluation, for example:

- `user_artist_scrobble_counts`

Recommended columns:

- `user_id`
- `artist_identity_id`
- `anchored_scrobble_count`
- `non_suppressed_scrobble_count`
- `community_id` if `community_local` scope is supported in the aggregate itself
- optional `distinct_track_count` if product wants distinct-track gating
- optional rolling-window support fields if needed
- `updated_at`

Why this should be materialized:

- community join is a hot path
- posting gates are also latency-sensitive
- scanning raw `scrobble_ingest_events` plus track joins at request time is the wrong cost profile

The existing control-plane [projection_outbox](../../pirate-api/db/control-plane/migrations/0003_control_plane_scrobbles.sql) is the natural maintenance mechanism for this aggregate. The aggregate should be updated incrementally from projection jobs rather than rebuilt ad hoc in the community gate path.

### 3. Add new control-plane migrations

Add migrations for:

- track catalog or track-to-artist projection
- user-artist scrobble aggregate
- any projection-outbox payload or worker support needed to keep those projections current

### 4. Clean up community-template migration duplication

Resolve the duplicate gate-rule migrations before widening the gate-family check.

### 5. Widen the gate family model

Extend the gate family union everywhere it is closed today:

- community-template DDL
- API contract types
- API request/response types
- normalization input types

New family:

- `activity_proof`

### 6. Add gate normalization

Add support for:

- `gate_family = "activity_proof"`
- `gate_type = "artist_scrobble_count"`

Validation should require:

- `artist_identity_id` as a non-empty string
- `min_scrobbles` as an integer `>= 1`
- `window_days` as `null` or an integer `>= 1`
- `anchor_status` from an explicit allowed set if exposed

### 7. Add an activity gate evaluator

Introduce an evaluator such as:

- `evaluateScrobbleActivityGate(...)`

It should query the aggregate projection and return a tri-state result, not a bare boolean.

Suggested shape:

```ts
type GateEvaluationResult =
  | { status: "passed" }
  | { status: "failed" }
  | { status: "indeterminate"; reason: string }
```

This is not just a helper addition. It implies a signature change in the shared gate runtime. The current `satisfiesCommunityGateRules(...)` returns `Promise<boolean>`, which cannot preserve `indeterminate`.

### 8. Extend gate evaluation context

Extend `GateEvaluationContext` to carry an activity evaluator alongside the token evaluator.

### 9. Wire the new family into membership and posting checks

Update the existing gate runtime so `activity_proof` participates in the same AND semantics as the other families.

Recommended shape:

- change `satisfiesCommunityGateRules(...)` from `Promise<boolean>` to `Promise<GateEvaluationResult>`
- propagate that change through membership and posting call sites
- map results as follows:
  - `passed`:
    - continue evaluation
  - `failed`:
    - return normal gate failure
  - `indeterminate`:
    - throw internal service error

This is the point where the current catch-all for unknown families must be replaced. If that branch is left unchanged, every `activity_proof` rule will silently fail regardless of schema and type updates.

Primary call sites:

- membership join flow
- posting gate flow

### 10. Treat backend failures as service failures

If the activity evaluator cannot determine eligibility because the backend is unavailable or the projection is broken:

- do not return ordinary gate failure
- fail as an internal service problem

That prevents silent false denials.

### 11. Add tests

Add tests parallel to the existing token-gate tests for:

- normalization
- membership evaluation
- route persistence
- backend failure handling
- rolling-window logic if supported

## Why Not Onchain

An onchain version of this feature would require much more than the current contract provides:

- track registration that exposes artist identity, not just metadata hash
- per-user per-artist aggregate state or an attestation model
- an onchain membership or gate contract that consumes that state
- higher gas and more complex write flows for every scrobble

That is a different system, not a small extension of `ScrobbleV1`.

The current architecture is better:

- the contract emits canonical scrobble events
- the backend builds projections
- community gates consume those projections

## Open Questions

- Should the first version count lifetime scrobbles only, with rolling windows deferred?
- Should the first version count only `anchored` scrobbles, or also include accepted-but-not-yet-anchored scrobbles?
- Should posting gates support artist activity immediately, or should v1 scope this to membership only?
- Is there already a hidden or untracked track catalog source outside the inspected files that can provide `track_id -> artist_identity_id` without new schema work?

## Final Recommendation

Proceed only if the implementation starts with the missing projection layer.

The correct order is:

1. materialize `track_id -> artist_identity_id`
2. materialize user-artist scrobble aggregates
3. add `activity_proof`
4. add `artist_scrobble_count`
5. wire membership and posting enforcement

Do not modify the Story scrobble contract for this feature.
