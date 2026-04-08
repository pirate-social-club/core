# Follow

Status: draft

Related docs:

- [profile.md](./profile.md)
- [user.md](./user.md)
- [feed.md](./feed.md)

## Purpose

This doc defines Pirate's public follow graph behavior.

It covers:

- source of truth for follows
- profile read-model fields
- follow and unfollow write surfaces
- caching and materialization rules
- public-profile targeting rules

It does not cover:

- blocks or mutes
- follow recommendations
- notification behavior for follows
- ranking formulas that may later use follow signals

## Normative Language

In this doc:

- `must` means required for a conforming v0 implementation
- `should` means the recommended default unless Pirate intentionally chooses otherwise
- `may` means optional behavior

## Core Principle

Pirate should expose follow as a product feature without pretending Pirate owns the underlying source of truth.

In v0:

- EFP is the follow source of truth
- Pirate exposes product APIs and read models around that source
- cached/materialized read models are operational projections, not the canonical follow ledger

## Source Of Truth

V0 follow state is derived from EFP.

Rules:

- Pirate does not define a canonical app-owned `follows` table as the source of truth in v0
- follow state is resolved from user-linked wallet identity into EFP list state
- Pirate may cache or materialize follow reads, but those caches are read models only

### Canonical Write Chain

V0 should treat Base as the canonical follow write chain for EFP-backed follow actions.

Rules:

- Pirate follow writes should target the canonical Base-backed EFP flow in v0
- the product should not present multi-chain follow writes as a user-facing concept unless Pirate explicitly expands the model later
- read paths may still need to understand the underlying EFP resolution model, but the product contract stays simple: Pirate follow actions use the canonical Base write path

## Follow Targeting Rules

Follow applies to public profiles only.

Rules:

- follow edges target a user's public identity surface, not anonymous guild-local presentation
- anonymous labels such as `anon_mercury-17` are never valid follow targets
- enabling anonymous posting in a guild does not change who can be followed; the follow edge still targets the underlying public profile
- clients should only render follow controls on non-anonymous public profile surfaces

## Resolution Model

Recommended v0 read-time resolution:

1. resolve the target `user_id` to the user's canonical follow wallet attachment
2. resolve the viewer `user_id` to the viewer's canonical follow wallet attachment
3. read EFP state for the viewer/target pair
4. project the result into Pirate's profile read model

Rules:

- `user_id` remains Pirate's canonical identity
- wallet addresses remain necessary for EFP integration, but they are integration inputs rather than the public product identity
- v0 should use a single canonical EFP-capable wallet per user rather than attempting to merge follow state across multiple attached wallets
- the canonical follow wallet should default to the user's primary attached EIP-155 wallet unless Pirate later introduces explicit follow-wallet selection
- if a user lacks a usable wallet attachment for EFP resolution, follow state may resolve as unavailable rather than inventing fake follow data

## Cached Read Model

Follow reads should be cached/materialized for Pirate profile surfaces.

Suggested v0 profile follow fields:

- `viewer_follows`
- `follower_count`
- `following_count`

Rules:

- `viewer_follows` is viewer-specific and should be cached by `(viewer_user_id, target_user_id)` with a short TTL and explicit invalidation after local follow/unfollow actions
- `follower_count` and `following_count` should be materialized/cached counts, not live EFP API fetches on every profile render
- cached counts may be refreshed on a schedule and/or in response to successful follow/unfollow writes
- temporary staleness is acceptable so long as Pirate treats the cached values as read models rather than as canonical truth

### Cache Refresh After Writes

Pirate follow writes target Base/EFP rather than an app-owned follow table, so cache refresh must be explicit.

Recommended v0 approach:

- when Pirate initiates a follow or unfollow write, it should update the requesting viewer's local read model optimistically
- the backend should enqueue or trigger reconciliation for the affected viewer/target pair and the related count projections
- reconciliation should be driven by confirmed write results, background polling, indexed chain events, or a combination of these
- Pirate should not rely on a client-only optimistic update as the sole cache refresh mechanism

## Eventual Consistency

EFP-backed follow state is eventually consistent.

Rules:

- follow reads may lag behind the most recent write
- Pirate clients may optimistically update local UI after follow/unfollow actions
- the optimistic mechanism itself is a client implementation detail, not part of the domain spec
- any product surface that depends on follow state for authorization, such as `followers_only` messaging, must account for this lag explicitly

## Write API Surface

Pirate should expose follow through user-oriented APIs, not raw EFP operations.

Recommended v0 endpoints:

- `POST /profiles/{user_id}/follow`
- `POST /profiles/{user_id}/unfollow`

Rules:

- Pirate resolves `user_id` to the necessary EFP write inputs internally
- the public API should not require callers to understand list slots, contract addresses, or low-level EFP ops
- follow writes are invalid against anonymous presentation-only surfaces
- self-follow must be rejected
- duplicate follow requests should be idempotent success that leave the effective follow state as followed
- duplicate unfollow requests should be idempotent success that leave the effective follow state as not-followed
- `POST` is acceptable here because these endpoints trigger mediated side effects against an external onchain source of truth rather than CRUD over a Pirate-owned follow row
- if EFP or the write path is unavailable, Pirate should fail the write clearly rather than silently queueing it unless a durable retry system is explicitly introduced

## Read API Surface

Follow state should be available primarily through profile read models in v0.

Recommended behavior:

- profile reads include `viewer_follows`, `follower_count`, and `following_count`
- separate follower/following list endpoints may be added later if Pirate needs dedicated social graph browsing

## Notification Policy

Follow notifications are not required in v0.

Rules:

- Pirate should prioritize higher-signal notifications such as membership admission, replies, mentions, moderation review, and moderation outcomes
- `followed_you` may be reserved for later, but it should not be a required v0 notification kind

## Relationship To Old Pirate

Old Pirate already demonstrates the operational pattern Pirate should preserve:

- reads and writes go to EFP
- the app resolves follow state from wallet-linked identity
- client UI may optimistically update while waiting for the follow source of truth to settle

V2 should keep that behavior while clearly specifying that Pirate-owned read models are caches/projections, not the canonical follow ledger.

## Open Questions

- Should v0 expose dedicated follower/following list endpoints, or only counts plus `viewer_follows`?
- What is the preferred refresh policy for cached counts after follow/unfollow writes?
- Should Pirate expose freshness metadata on cached follow read models when EFP is degraded or stale?
