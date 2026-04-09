# Contracts Overview

Status: draft

Related docs:

- [../domain/guild.md](../domain/guild.md)
- [../domain/namespace.md](../domain/namespace.md)
- [../domain/artist-identity.md](../domain/artist-identity.md)
- [../domain/handles.md](../domain/handles.md)
- [../domain/asset.md](../domain/asset.md)
- [../domain/royalty-graph.md](../domain/royalty-graph.md)
- [../domain/marketplace.md](../domain/marketplace.md)
- [../domain/monetization.md](../domain/monetization.md)
- [../domain/feed.md](../domain/feed.md)

## Purpose

This doc defines which parts of Pirate need onchain contracts in v0 and which parts should remain app-level.

It covers:

- contract-required product areas
- chain placement
- offchain-first areas
- recommended v0 contract surface
- later upgrade paths

## Non-goals

This doc does not define:

- exact ABIs
- Solidity interfaces
- deployment scripts
- final contract naming

## Core Principle

Only put onchain what benefits materially from onchain execution in v0.

Pirate should not force guild, feed, or identity features onchain just because some adjacent parts already are.

Pirate should also prefer Story's existing asset and royalty primitives where they already solve the problem cleanly.

## Execution Chain

The primary execution chain for Pirate's royalty-native commerce flows is Story.

Reasoning:

- Story is where IP assets are published
- Story is where royalty-native flows live
- keeping listing, purchase, and royalty-compatible settlement on the same chain avoids cross-chain payout complexity

## What Must Be Onchain In V0

### Story-Native Asset And Royalty Flows

These remain on Story:

- Story IP asset publication
- derivative linkage where Story is the source of truth
- royalty-compatible payment flows

Recommended v0 asset posture:

- use Story's standard NFT-plus-IP registration flow
- keep Pirate-managed Story collection strategy small and simple
- do not create one Story collection per guild in v0

Pirate should rely on Story's existing protocol contracts where possible rather than recreating those primitives.

### Track Registry And Scrobble Events

Music listening activity is meaningful product state for Pirate and should have a real Story-side contract surface.

Reasoning:

- scrobbles are valuable music-guild reputation and activity data
- track registration and scrobble history benefit from shared onchain visibility
- scrobble thresholds can later drive audience segments, unlocks, and guild recognition
- this is already a proven pattern in `pirate/` via `ScrobbleV4`

Recommended v0 shape:

- one Story-side scrobble contract
- track registry keyed by stable `track_id`
- cheap event-oriented scrobble writes
- delegated operator path for trusted ingestion flows such as desktop scrobbling

Important boundary:

- onchain scrobble data is the canonical event layer
- aggregation, ranking, streaks, badges, and guild views remain offchain read models

### Marketplace Purchase Execution

Primary sales for royalty-native assets should execute on Story.

This includes:

- receiving the protocol-side settlement token
- routing payout according to the active payout policy
- invoking royalty-compatible settlement behavior where required

Concrete meaning:

- the settlement contract receives the buyer's already-resolved purchase amount
- it applies the payout waterfall
- it records or emits purchase success
- it hands off to receipt or access-grant logic if needed

### Locked Asset Delivery Primitives

Locked payloads should prefer Story-native encrypted delivery primitives.

Implementation note:

- Story CDR is the preferred primitive for locked/gated payload access on Story
- Pirate should prefer Story-native access-control and encryption infrastructure over rolling its own

### Purchase Entitlement And Access Control

If Pirate sells locked or licensed digital assets in v0, the buyer entitlement path should have a Story-native execution surface.

This may include:

- purchase settlement execution
- access grant writes for locked assets
- optional receipt or entitlement token minting
- CDR read-condition support

Concrete meaning:

- a successful purchase must turn into a buyer-readable entitlement state
- for locked assets, that usually means updating an access-control path used by CDR-compatible reads
- for public assets, that may only mean a recorded receipt/license entitlement

Pirate should keep the legal/product meaning simple:

- buyer receives a license/access entitlement
- not copyright transfer
- not guild ownership

## What Should Stay Offchain In V0

### Guild Identity And Settings

These should remain app-level in v0:

- guild existence
- guild settings
- guild gates
- moderation policy
- feed policy

Reasoning:

- these need iteration speed
- they are not improved enough by immediate onchain execution to justify the complexity

### Feeds And Ranking

Feed generation and ranking stay offchain.

This includes:

- `Home`
- `Your Guilds`
- guild feed ranking

Even if guild governance later influences ranking policy, feed execution remains an app-level concern.

This does not conflict with having an onchain scrobble event layer for music activity.

The rule is:

- event publication may be onchain where it materially helps the music product
- ranking and feed assembly remain offchain

### Posts, Comments, And Votes

Social write activity stays offchain in v0.

This includes:

- post rows
- comments and threaded replies
- likes or upvotes
- moderation overlays

Pirate may later anchor or mirror some social activity onchain, but v0 should not require chain writes for ordinary social interaction.

### Handles

Handles remain offchain-first in v0.

Reasoning:

- lease, renewal, revocation, and namespace policy are still evolving
- guilds start creator-controlled
- premature onchain issuance creates rug and support risk

Onchain handle issuance is a later upgrade path after governance hardening.

Namespace delegation implication:

- when a root owner delegates namespace management to Pirate, Pirate becomes the operational authority for offchain handle issuance in that namespace
- that is an application-trust and resolver-operations concern, not a reason to force v0 handle issuance onchain

### User Identity And Verification

These remain app-level:

- `user_id`
- wallet attachments
- Privy auth-provider links
- verification sessions and identity snapshot
- Reddit trust snapshots

External attestations and mirrors may exist, but Pirate's canonical user model remains app-level in v0.

## External Roots And Proofs

HNS and Spaces root ownership are required for guild creation, but Pirate does not need to own those protocols.

V0 contract implication:

- Pirate verifies root control and delegation state
- Pirate does not deploy its own substitute naming protocol for them

These are external dependencies, not Pirate-core contracts.

## Payout Policy Control

Payout policy starts as an app-level record.

Recommended progression:

1. `platform_default`
2. `guild_override`
3. `governance_controlled`

In early v0:

- policy resolution may still happen offchain
- guild treasury is a wallet or multisig address
- onchain purchase execution consumes the resolved policy inputs

Later, policy resolution may move closer to governance-managed or contract-managed control.

## Routed Funding

Routed funding is not a Pirate-core contract dependency.

Interpretation:

- buyers may fund from supported source assets/chains
- routing happens before Story execution
- the routed funding provider is implementation infrastructure, not Pirate protocol logic

Pirate contracts should only assume that the required Story-side settlement token arrives before purchase execution.

## Pricing Policy Resolution

Pricing policy remains app-level in v0.

This includes:

- USD catalog pricing
- regional pricing derived from verified nationality or pricing tiers
- final quote resolution before the onchain purchase executes

Contracts should consume the resolved purchase amount, not interpret nationality or cost-of-living rules directly.

## Likely V0 Contract Surface

Pirate-specific v0 contracts should stay narrow.

Likely areas:

- track registry and scrobble events on Story
- publish/access coordination for locked song assets on Story
- marketplace purchase execution on Story
- payout routing on Story
- CDR read-condition support on Story
- optional receipt or entitlement token later, if needed

Pirate should avoid building dedicated v0 contracts for:

- guild creation
- feed ranking
- gating policy storage
- user identity

## Recommended V0 Contract Set

Based on the existing `pirate/` Story stack, the most sensible v0 contract inventory is:

### 1. Scrobble Contract

Role:

- register tracks
- emit scrobble events
- support trusted operator-assisted scrobbling

Notes:

- this is already validated by `ScrobbleV4` in `pirate/`
- it is the strongest candidate for a first-class Pirate v2 contract outside direct marketplace settlement

### 2. Publish And Content Access Contracts

Role:

- register locked song payload pointers
- coordinate content publication lifecycle
- grant and revoke paid access

Notes:

- `pirate/` currently uses `PublishCoordinatorV1` plus `ContentRegistry`
- this should remain Story-side for locked song delivery flows
- the exact v2 implementation may be a migration or a rewrite, but the responsibility split should remain similar

### 3. CDR Condition / Access Proof Contracts

Role:

- enforce locked-payload reads and writes through Story CDR-compatible conditions
- validate short-lived Pirate-issued access proofs

Notes:

- `pirate/` already has `SignedPurchaseCondition` and `ContentRegistryCdrConditionV1`
- Pirate should reuse this direction rather than inventing a custom encryption gate

### 4. Marketplace Settlement Contract

Role:

- receive the Story-side royalty-compatible settlement token
- route payout according to the active payout policy
- trigger or record purchase entitlement state

Notes:

- this may stay separate from the CDR condition and content registry contracts
- the marketplace contract should stay small and focused on purchase execution

### 5. Optional Purchase Receipt Contract

Role:

- mint a buyer-visible receipt or entitlement token

Notes:

- useful, but not strictly required if app-level purchase records are enough at launch
- `pirate/` currently has `PurchaseReceiptV2`

## Explicit Non-V0 Contracts

Pirate does not need dedicated v0 contracts for:

- guild records
- namespace binding
- handle issuance
- feed ranking formulas
- artist verification
- identity verification
- guild gate rule storage

## Royalty Graph Dependency

The detailed royalty-graph shape is now defined in [../domain/royalty-graph.md](../domain/royalty-graph.md).

Contract implication:

- payout-routing and marketplace settlement contracts should treat the royalty graph as the app-level source that classifies upstream obligations
- Story-native edges remain the source of truth for protocol-enforced royalty passthrough
- Pirate-native edges may still inform optional or guild-defined sharing behavior without pretending to be Story-enforced

## Future Contract Areas

Possible later contract areas:

- handle issuance registry after governance hardening
- governance-controlled payout policy modules
- onchain entitlement receipts
- broader treasury automation

These are later upgrades, not v0 requirements.

## Open Questions

- Should v0 marketplace execution and payout routing live in one Story contract or be split into separate contracts?
- Does v0 need an onchain buyer receipt, or is an app-level purchase record enough?
- At what governance threshold should handle issuance or payout policy move onchain?
- Which `pirate/` Story contracts should be migrated forward mostly intact versus rewritten for Pirate v2?
