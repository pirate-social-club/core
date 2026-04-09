# Monetization

Status: draft

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [royalty-graph.md](./royalty-graph.md)
- [marketplace.md](./marketplace.md)
- [donations.md](./donations.md)
- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [rights-review.md](./rights-review.md)

## Purpose

This doc defines how sellable Pirate assets route money between creators, communities, the platform, and upstream royalty participants.

It covers:

- default payout policy
- club treasury routing
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
- `community_id`
- `mode`
- `creator_share_pct`
- `club_fee_pct`
- `platform_fee_pct`
- `upstream_royalty_mode`
- `upstream_optional_pct` nullable
- `club_treasury_ref`
- `settlement_backend_ref` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `mode`
  - `platform_default`
  - `club_override`
  - `governance_controlled`
- `upstream_royalty_mode`
  - `none`
  - `passthrough`
  - `club_optional`

Notes:

- percentages are product-level policy values in v0; implementation precision is a later concern
- `club_treasury_ref` is the canonical settlement destination reference for club-fee proceeds
- `settlement_backend_ref` may later point to a multisig, DAO treasury, or contract-backed settlement backend
- creator-side charitable donation eligibility is enabled by club donation policy, while the actual opt-in and share live on the listing object

## Default V0 Split

Launch default for sellable original works with no upstream royalty obligation:

- creator: `90%`
- club: `0%`
- platform: `10%`

Interpretation:

- the creator receives the large majority of sale proceeds
- there is no club fee at launch because `platform_default` communities have no real treasury destination yet; `club_treasury_ref` starts as a creator-controlled wallet, which is not a communal treasury
- the platform fee covers storage, analysis, verification, Story integration, and marketplace infrastructure

### Club Fee Activation

The club fee is deferred until the community has a real governance-controlled treasury.

Rules:

- in `platform_default` mode, `club_fee_pct` is `0%`; there is no club fee
- the club fee activates when the payout policy mode advances to `club_override` or `governance_controlled`
- at that point `club_treasury_ref` should point to a multisig or DAO-controlled destination, not a personal wallet
- the transition from `platform_default` to `club_override` is when club economics become legitimate

Rationale:

- charging a club fee before a communal treasury exists risks appearing as an operator skim at the exact moment growth is the priority
- the club operator's early incentive is attracting pirates and future handle demand, not skimming content sales
- Pirate still earns the 10% marketplace platform fee from day one
- club treasury growth can come later from handle/SLD economics, donation flows, and governance unlocks

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

- donation is only available when the club has an active donation partner
- donation participation is opt-in on the listing
- `listing.donation_share_pct`, when set, is taken from creator-side proceeds
- `listing.donation_partner_id_snapshot` is the destination reference used for settlement
- donation must not reduce required upstream royalty passthrough
- donation must not replace the normal club treasury share

Interpretation:

- club treasury routing and charity routing are separate
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
  - club: `4%`
  - platform: `8%`

This is equivalent to:

- upstream: `20%`
- creator: `68%`
- club: `4%`
- platform: `8%`

### `club_optional`

The club may choose to route an optional upstream share even when there is no hard legal or graph-required upstream obligation.

This is the money-side equivalent of attribution-oriented sharing.

Rules:

- off by default in v0
- when enabled, `upstream_optional_pct` defines the optional upstream share
- optional upstream sharing is taken before the remaining amount is split by the club payout policy

## Payout Waterfall

Recommended v0 order:

1. buyer pays
2. external payment/network fees are removed
3. if `upstream_royalty_mode = passthrough`, required upstream royalties are paid
4. if `upstream_royalty_mode = club_optional`, optional upstream share is paid when enabled
5. remaining distributable amount is split between creator, club, and platform according to the active payout policy
6. if the listing is donation-enabled, the configured donation share is routed from the creator-side proceeds to the snapped donation partner
7. remaining creator payout is delivered

This keeps upstream obligations ahead of club/platform economics.

## Livestream Revenue Boundary

Livestream access sales follow the same payout waterfall, but room access and performer settlement should not be conflated.

Recommended v0 rule:

- a paid `live_room` listing sells access to the room or replay
- sale proceeds follow the active club payout policy
- performer-side proceeds should then be split according to the room's explicit performer allocations

Interpretation:

- `solo` and `duet` rooms still settle through the room listing plus the club payout policy first
- performer allocations only divide the performer-side proceeds after upstream, club, and platform obligations have been resolved
- if a creator-side donation sidecar is enabled on a live or replay listing, it should reduce the performer-side pool before the final performer allocation split, unless later policy explicitly chooses a different ordering
- song-specific live splits still require a later segment or replay-rights model
- ACRCloud recognition on the live mix or replay may produce evidence for later rights or payout review, but it must not auto-rewrite the live settlement waterfall in real time in v0

Rights-review hold:

- if a room or replay triggers an ACRCloud match that Pirate treats as rights-relevant, creator or club-side payout distribution should enter a pending rights-review hold
- in v0, the Pirate platform operator is the review authority that releases, reroutes, or blocks those held payouts
- club owners, TLD owners, or performers may provide evidence, but they are not the final release authority for flagged third-party rights cases

## Community Treasury Control

When a club fee is active, it must route to a treasury address controlled by the club's current governance layer.

Recommended progression:

1. `platform_default` (launch)
   - `club_fee_pct` is `0%`; no club fee is charged
   - `club_treasury_ref` may be null or point to a creator-controlled wallet as a placeholder
   - club economics are deferred until governance hardens
2. `club_override` (multisig)
   - `club_fee_pct` may be set above `0%` by the operator with platform policy bounds
   - `club_treasury_ref` must point to the club multisig destination
3. `governance_controlled` (DAO)
   - `club_fee_pct` is governed by the DAO or governance-managed configuration
   - `club_treasury_ref` moves to the DAO treasury or DAO-controlled settlement backend

This matches the governance progression already defined in [community.md](./community.md).

## Governance And Policy Control

Recommended v0 progression:

### `platform_default`

- Pirate defines the payout policy
- club fee is `0%`; no club treasury share
- club operators cannot arbitrarily change splits
- safest and most attractive mode for new communities

### `club_override`

- a stronger operator setup, typically creator plus multisig, may change approved payout parameters
- platform should still enforce policy bounds in v0

### `governance_controlled`

- the attached governance backend controls payout policy
- policy may be resolved from DAO or governance-managed configuration

Pricing policy is distinct from payout policy.

Locked-in v0 rule:

- payout splits may remain under platform or governance bounds
- regional pricing policy is club-controlled in v0
- Pirate may offer suggested pricing templates, including PPP-style defaults, but the active country-level pricing policy is authored by the club
- nationality-tiered pricing requires Self-backed nationality proof; buyers without that proof pay the base price

## Sellability

An asset should only be sellable when:

- it is eligible for commerce under its rights path
- any required Story publication or derivative linkage is complete
- moderation and safety policy permit commerce for that asset

Examples:

- original fan art with no upstream obligation
  - sellable under default payout policy
- official artist song in an artist-governed club
  - sellable subject to its Story and royalty configuration
- derivative remix with unsupported upstream rights
  - not sellable

## On-chain vs Off-chain

Recommended v0 split:

- payout policy lives as an app-level record
- `club_treasury_ref` may resolve to an EVM wallet, multisig, contract, or later non-EVM settlement destination
- pricing and policy resolution remain app-level in v0
- Story-side purchase settlement for royalty-native sales should still execute onchain
- onchain contracts consume resolved payout inputs rather than deriving pricing policy themselves

## Open Questions

- Which asset types are sellable in v0 versus publish-only?
- What policy bounds should Pirate enforce before a club may move from `platform_default` to `club_override`?
- What should the default club fee be when it activates at `club_override`?
