# Donations

Status: community partner and listing-level allocation implemented; real Endaoment execution deferred until mainnet commerce.

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
- monetized creator content may opt into donating part of the gross sale price before net Story settlement
- the donation destination does not vary per post in normal v0 flows

This reduces scam surface area and keeps club identity coherent.

## Donation Partner Entity

`donation_partner_id` must point to a real reviewed partner object.

The `donation_partners` table is defined in the community-template SQLite schema (`db/community-template/migrations/1038_donation_partners.sql`). In v0 it stores partner metadata per-community.

Fields:

- `donation_partner_id` (TEXT PRIMARY KEY)
- `display_name` (TEXT NOT NULL)
- `provider` (TEXT NOT NULL CHECK `endaoment`)
- `provider_partner_ref` (TEXT)
- `payout_destination_ref` (TEXT)
- `image_url` (TEXT)
- `review_status` (TEXT NOT NULL CHECK `pending` | `approved` | `rejected`)
- `status` (TEXT NOT NULL CHECK `active` | `paused` | `retired`)
- `created_at` (TEXT NOT NULL)
- `updated_at` (TEXT NOT NULL)

Rules:

- v0 supports `provider = endaoment` only
- only `review_status = approved` partners may be attached to communities in v0
- the partner object, not the post or listing, owns provider-specific payout routing data
- `payout_destination_ref` must be populated before donation-enabled quote issuance
- partner approval is a platform-admin action in v0

V0 Endaoment note:

- for `provider = endaoment`, `provider_partner_ref` carries the Endaoment organization identifier
- `payout_destination_ref` is the settlement destination reference used by Pirate's Endaoment integration

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

Monetized creator listings may opt into donating part of the gross resolved sale price.

Suggested v0 listing-level participation fields:

- `donation_share_pct` nullable
- `donation_partner_id` nullable

Rules:

- donation participation lives on the listing, not the asset row and not the club payout policy
- donation participation is optional per monetized listing
- a null `donation_partner_id` means donation is disabled for the listing
- donation share is taken from the gross sale price before the net amount enters Story's royalty graph
- donation share does not change the platform fee unless Pirate explicitly adds such a mode later
- donation reduces the net revenue paid into Story for this sale
- `donation_share_pct` must satisfy `0 < donation_share_pct <= 50` in v0
- when a creator enables donation on a listing, Pirate snapshots the current club donation partner into `donation_partner_id`
- if `donation_partner_id` is non-null, then `donation_share_pct` must be non-null
- if donation is disabled, then `donation_share_pct = null` and `donation_partner_id = null`
- donation may only be enabled when the club donation policy allows it and `donation_partner_status = active`

Interpretation:

- the creator is choosing a listing-level charity tax on the sale
- the donation goes to the listing's snapped club donation partner
- the post itself is not choosing a new charity destination every time

Purchase-time settlement should snapshot donation routing for reporting.

Suggested v0 purchase-level settlement fields:

- `allocations[]`
- compatibility donation fields:
  - `donation_partner_id` nullable
  - `donation_share_pct` nullable
  - `donation_amount_usd` nullable
  - `donation_settlement_ref` nullable

Rules:

- the quote's allocation snapshot is authoritative for settlement execution
- donation reporting fields are a compatibility projection of the charity allocation leg, not the canonical settlement model
- when the charity allocation leg is present, its amount is rounded at quote time and creator receives the remainder

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

Donation sits inside the monetization waterfall before Story royalty-native settlement.

Recommended v0 order:

1. buyer pays
2. external payment/network fees are removed
3. if creator donation is enabled, the charity slice is routed from the gross sale amount to the snapped donation partner
4. the remaining net amount is paid into Story's Royalty Module
5. required upstream royalties are resolved by Story when applicable
6. remaining creator-side proceeds become claimable through Story

Important boundary:

- donation is not a substitute for club treasury contribution
- club treasury routing and charity routing are separate destinations
- Story's royalty graph receives the post-donation net amount

## Endaoment Execution

Endaoment uses a real-money onchain entity donation path, so it is deferred while Pirate commerce runs on Story Aeneid and Base Sepolia testnet rails.

When the whole commerce stack moves to mainnet, provider execution uses Endaoment's onchain entity donation path.

Current testnet rule:

- donation partners can be configured for policy and preview UX
- donation-enabled listings and quotes require provider configuration when execution is attempted
- hosted dev/staging/prod should not use real Endaoment payout keys while Story settlement is still Aeneid

Rules:

- `provider = endaoment` requires `payout_destination_ref` to be the Endaoment entity contract address
- Pirate verifies the Endaoment entity is active through the configured Endaoment Registry before donation
- Pirate donates USDC through the entity contract's `donate(uint256)` function
- the backend payout signer must hold enough USDC on the configured Endaoment-supported chain
- the provider settlement reference is the confirmed Endaoment donation transaction hash
- provider receipt references may include chain/entity/transaction correlation
- tax receipt references are nullable because Endaoment receipt generation may complete later

Runtime configuration when enabled:

- `ENDAOMENT_PAYOUT_PRIVATE_KEY`
- `ENDAOMENT_RPC_URL`
- `ENDAOMENT_CHAIN_ID`
- `ENDAOMENT_USDC_TOKEN_ADDRESS`
- `ENDAOMENT_REGISTRY_ADDRESS`

Durability:

- charity payout attempts are recorded in `purchase_settlement_effects`
- retries reuse a confirmed charity effect instead of calling the provider again
- the idempotency key is derived from quote id plus allocation identity
- if the provider call fails before confirmation, the effect is marked failed and can be retried

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
