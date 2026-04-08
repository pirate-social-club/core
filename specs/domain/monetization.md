# Monetization

Status: draft

Related docs:

- [guild.md](./guild.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [royalty-graph.md](./royalty-graph.md)
- [marketplace.md](./marketplace.md)
- [donations.md](./donations.md)
- [livestream.md](./livestream.md)

## Purpose

This doc defines how sellable Pirate assets route money between creators, guilds, the platform, and upstream royalty participants.

It covers:

- default payout policy
- guild treasury routing
- creator-side charitable donation routing
- regional pricing interaction
- upstream royalty handling
- governance progression for payout control

## Non-goals

This doc does not define:

- marketplace UI or listing UX
- payment processor implementation details
- exact on-chain settlement contracts
- tax or regulatory compliance flows

## Core Principle

Publishing and selling are separate concerns.

- `post` is the social object
- `asset` is the optional rights-bearing object
- `listing` or `sale` is the commerce object

Not every asset is sellable.

An asset may only be listed for sale when:

- the asset passed upload analysis and moderation policy
- the selected rights path allows commerce
- any required upstream royalty or derivative conditions are satisfied

## Payout Policy Model

Suggested v0 policy fields:

- `payout_policy_id`
- `guild_id`
- `mode`
- `creator_share_pct`
- `guild_fee_pct`
- `platform_fee_pct`
- `upstream_royalty_mode`
- `upstream_optional_pct` nullable
- `guild_treasury_ref`
- `settlement_backend_ref` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `mode`
  - `platform_default`
  - `guild_override`
  - `governance_controlled`
- `upstream_royalty_mode`
  - `none`
  - `passthrough`
  - `guild_optional`

Notes:

- percentages are product-level policy values in v0; implementation precision is a later concern
- `guild_treasury_ref` is the canonical settlement destination reference for guild-fee proceeds
- `settlement_backend_ref` may later point to a multisig, DAO treasury, or contract-backed settlement backend
- creator-side charitable donation eligibility is enabled by guild donation policy, while the actual opt-in and share live on the listing object

## Default V0 Split

Recommended default for sellable original works with no upstream royalty obligation:

- creator: `85%`
- guild: `5%`
- platform: `10%`

Interpretation:

- the creator receives the majority of sale proceeds
- the guild gets a modest treasury contribution
- the platform fee covers storage, analysis, verification, Story integration, and marketplace infrastructure

## Regional Pricing Interaction

Regional pricing changes the gross purchase amount before the payout waterfall runs.

Rules:

- the payout policy percentages apply to the buyer's final resolved purchase price
- nationality or pricing-tier logic must not be recomputed inside the payout waterfall
- pricing-tier derivation is handled by marketplace policy before settlement executes

This keeps pricing fairness and payout accounting as separate concerns.

## Creator Donation Sidecar

Charitable donation in v0 should be a creator-side sidecar, not a post-level destination picker.

Rules:

- donation is only available when the guild has an active donation partner
- donation participation is opt-in on the listing
- `listing.donation_share_pct`, when set, is taken from creator-side proceeds
- `listing.donation_partner_id_snapshot` is the destination reference used for settlement
- donation must not reduce required upstream royalty passthrough
- donation must not replace the normal guild treasury share

Interpretation:

- guild treasury routing and charity routing are separate
- creator donation is a sacrifice by the creator, not a remapping of someone else's owed share

## Upstream Royalty Handling

### `none`

No upstream royalty share is applied.

Use when:

- the asset is original
- no derivative graph or upstream obligation exists

### `passthrough`

If the royalty graph or rights path requires upstream payment, that upstream amount is paid first.

Then the remaining distributable amount is split by the payout policy.

Example:

- upstream royalty: `20%`
- remaining amount: `80%`
- remainder split by default policy:
  - creator: `68%`
  - guild: `4%`
  - platform: `8%`

This is equivalent to:

- upstream: `20%`
- creator: `68%`
- guild: `4%`
- platform: `8%`

### `guild_optional`

The guild may choose to route an optional upstream share even when there is no hard legal or graph-required upstream obligation.

This is the money-side equivalent of attribution-oriented sharing.

Rules:

- off by default in v0
- when enabled, `upstream_optional_pct` defines the optional upstream share
- optional upstream sharing is taken before the remaining amount is split by the guild payout policy

## Payout Waterfall

Recommended v0 order:

1. buyer pays
2. external payment/network fees are removed
3. if `upstream_royalty_mode = passthrough`, required upstream royalties are paid
4. if `upstream_royalty_mode = guild_optional`, optional upstream share is paid when enabled
5. remaining distributable amount is split between creator, guild, and platform according to the active payout policy
6. if the listing is donation-enabled, the configured donation share is routed from the creator-side proceeds to the snapped donation partner
7. remaining creator payout is delivered

This keeps upstream obligations ahead of guild/platform economics.

## Guild Treasury Control

The guild fee must route to a treasury address controlled by the guild's current governance layer.

Recommended progression:

1. creator-controlled bootstrap
   - `guild_treasury_ref` defaults to a creator-controlled settlement destination
2. multisig-controlled guild
   - `guild_treasury_ref` moves to the guild multisig destination
3. DAO-controlled guild
   - `guild_treasury_ref` moves to the DAO treasury or DAO-controlled settlement backend

This matches the governance progression already defined in [guild.md](./guild.md).

## Governance And Policy Control

Recommended v0 progression:

### `platform_default`

- Pirate defines the payout policy
- guild operators cannot arbitrarily change splits
- safest mode for new guilds

### `guild_override`

- a stronger operator setup, typically creator plus multisig, may change approved payout parameters
- platform should still enforce policy bounds in v0

### `governance_controlled`

- the attached governance backend controls payout policy
- policy may be resolved from DAO or governance-managed configuration

## Sellability

An asset should only be sellable when:

- it is eligible for commerce under its rights path
- any required Story publication or derivative linkage is complete
- moderation and safety policy permit commerce for that asset

Examples:

- original fan art with no upstream obligation
  - sellable under default payout policy
- official artist song in an artist-governed guild
  - sellable subject to its Story and royalty configuration
- derivative remix with unsupported upstream rights
  - not sellable

## On-chain vs Off-chain

Recommended v0 split:

- payout policy lives as an app-level record
- `guild_treasury_ref` may resolve to an EVM wallet, multisig, contract, or later non-EVM settlement destination
- pricing and policy resolution remain app-level in v0
- Story-side purchase settlement for royalty-native sales should still execute onchain
- onchain contracts consume resolved payout inputs rather than deriving pricing policy themselves

## Open Questions

- Which asset types are sellable in v0 versus publish-only?
- Should the default guild fee stay fixed at `5%` for all guilds until governance hardens?
- What policy bounds should Pirate enforce before a guild may move from `platform_default` to `guild_override`?
