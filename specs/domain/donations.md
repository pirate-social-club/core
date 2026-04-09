# Donations

Status: draft

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [monetization.md](./monetization.md)
- [marketplace.md](./marketplace.md)
- [royalty-graph.md](./royalty-graph.md)
- [livestream.md](./livestream.md)

## Purpose

This doc defines how charitable donations fit into Pirate monetization.

It covers:

- club-level donation partner configuration
- creator-side charitable opt-in on monetized listings
- donation sidecars on paid content
- fundraiser-primary modes for later live/club use

## Non-goals

This doc does not define:

- donation processor integrations
- tax receipt workflows
- cross-border nonprofit compliance
- live fundraiser UI details

## Core Principle

Donation destination should be a community policy, not an arbitrary post-level beneficiary field.

Recommended v0 model:

- the club defines the approved donation partner
- monetized creator content may opt into donating part of the creator-side proceeds
- the donation destination does not vary per post in normal v0 flows

This reduces scam surface area and keeps club identity coherent.

## Donation Partner Entity

`donation_partner_id` must point to a real reviewed partner object.

Suggested v0 `donation_partners` shape:

- `donation_partner_id`
- `display_name`
- `provider`
- `provider_partner_ref`
- `payout_destination_ref`
- `review_status`
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `provider`
  - `endaoment`
- `provider_partner_ref`
  Opaque provider-specific ID such as an Endaoment organization ID
- `payout_destination_ref`
  Canonical settlement destination reference resolved by Pirate when routing donation proceeds
- `review_status`
  - `pending`
  - `approved`
  - `rejected`
- `status`
  - `active`
  - `paused`
  - `retired`

Rules:

- v0 supports `provider = endaoment` only
- only `review_status = approved` partners may be attached to communities in v0
- `payout_destination_ref` is the source of truth for where donation proceeds route
- the partner object, not the post or listing, owns provider-specific payout routing data
- partner approval is a platform-admin action in v0

V0 Endaoment note:

- for `provider = endaoment`, `provider_partner_ref` should carry the Endaoment organization identifier
- `payout_destination_ref` should resolve through Pirate's Endaoment integration to the actual donation settlement destination used at payout time

## Community-Level Donation Partner

Suggested v0 club donation fields:

- `donation_partner_id` nullable
- `donation_policy_mode`
- `donation_partner_status`

Suggested meanings:

- `donation_policy_mode`
  - `none`
  - `optional_creator_sidecar`
  - `fundraiser_default`
- `donation_partner_status`
  - `unconfigured`
  - `active`
  - `paused`

Rules:

- a club may define one default donation partner in v0
- the partner should be reviewed and approved at the club level
- `donation_partner_status` is the status of the club's attachment to the partner, not the global partner record
- if no active donation partner exists, creator-side donation opt-in is unavailable

## Creator-Side Donation Participation

Monetized creator listings may opt into donating part of creator proceeds.

Suggested v0 listing-level participation fields:

- `donation_opt_in`
- `donation_share_pct` nullable
- `donation_partner_id_snapshot` nullable

Rules:

- donation participation lives on the listing, not the asset row and not the club payout policy
- donation participation is optional per monetized listing
- `donation_opt_in` is a boolean in v0
- donation share is taken from creator-side proceeds, not from upstream royalty obligations
- donation share does not change the platform fee unless Pirate explicitly adds such a mode later
- donation share does not change owed upstream royalty passthrough
- `donation_share_pct` must satisfy `0 < donation_share_pct <= 50` in v0
- when a creator enables donation on a listing, Pirate snapshots the current club donation partner into `donation_partner_id_snapshot`
- if `donation_opt_in = true`, then `donation_share_pct` and `donation_partner_id_snapshot` must be non-null
- if `donation_opt_in = false`, then `donation_share_pct = null` and `donation_partner_id_snapshot = null`
- donation opt-in may only be true when the club donation policy allows it and `donation_partner_status = active`

Interpretation:

- the creator is sacrificing part of their own payout
- the donation goes to the listing's snapped club donation partner
- the post itself is not choosing a new charity destination every time

Purchase-time settlement should snapshot donation routing for reporting.

Suggested v0 purchase-level donation fields:

- `donation_partner_id` nullable
- `donation_share_pct` nullable
- `donation_amount_usd` nullable
- `donation_settlement_ref` nullable

## Donation Modes

Recommended v0 and later modes:

### `none`

No donation behavior applies.

### `optional_creator_sidecar`

The club has an approved donation partner.

Creators may choose to route part of their creator-side payout to that partner when selling royalty-enabled content.

This is the recommended v0 default donation mode.

### `fundraiser_default`

The club or event may later operate in a fundraiser-first mode.

Examples:

- charity livestream
- benefit event
- campaign-oriented club week

This is a later extension and should not replace the simpler creator-side sidecar model in v0.

## Payout Interaction

Donation sits inside the monetization waterfall after upstream obligations and before final creator payout.

Recommended v0 order:

1. buyer pays
2. external payment/network fees are removed
3. required upstream royalties are paid when applicable
4. platform and community policy shares are resolved
5. if creator donation is enabled, the creator donation slice is routed from the creator-side proceeds
6. remaining creator payout is delivered

Important boundary:

- donation is not a substitute for club treasury contribution
- club treasury routing and charity routing are separate destinations
- donation does not alter required royalty-graph passthrough obligations

## Relationship To Posts

Posts may expose donation participation in UI, but the donation destination should still come from the club's donation policy.

Recommended v0 rule:

- do not let ordinary posts define arbitrary donation beneficiaries
- if a post is monetized and donation-enabled, the listing should reference the club donation partner indirectly through the monetization layer

## Partner Status Effects

Partner status changes must not silently rewrite creator intent.

Recommended v0 rules:

- if the global `donation_partners.status` becomes `paused` or `retired`, new donation-enabled listings using that partner cannot be created
- if a club attachment `donation_partner_status` becomes `paused`, new donation-enabled listings in that club cannot be created
- if an existing donation-enabled listing points at a partner that is no longer active, new purchases for that listing should fail until the listing is refreshed or donation is disabled
- if a club swaps from partner A to partner B, existing donation-enabled listings that snapshot A remain bound to A until refreshed or donation is disabled
- Pirate may require listing refresh before future purchases if the club intentionally replaces its donation partner
- previously settled purchases remain historically valid and do not get rewritten

## Open Questions

- Should fundraiser-default communities later support temporary campaign overrides without changing the long-lived club donation partner?
- When Pirate supports live fundraiser-primary rooms, should those use this same donation policy object or a live-specific overlay?
