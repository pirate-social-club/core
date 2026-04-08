# Marketplace

Status: draft

Related docs:

- [asset.md](./asset.md)
- [post.md](./post.md)
- [guild.md](./guild.md)
- [royalty-graph.md](./royalty-graph.md)
- [monetization.md](./monetization.md)
- [donations.md](./donations.md)
- [user.md](./user.md)
- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [karaoke.md](./karaoke.md)
- [rights-review.md](./rights-review.md)

## Purpose

This doc defines how Pirate turns eligible assets into purchasable listings.

It covers:

- listing and purchase objects
- buyer entitlement
- pricing and settlement assumptions
- regional pricing policy
- routed funding assumptions
- direct payout execution in v0

## Non-goals

This doc does not define:

- auction mechanics
- secondary resale markets
- escrow flows
- platform custody
- physical goods or shipping

## Core Principle

Publishing and selling are separate.

- `post` is the social object
- `asset` is the rights-bearing object
- `listing` is the sell offer
- `purchase` is the completed transaction
- `entitlement` is what the buyer receives

Not every asset is listed.
Not every listed asset is publicly accessible in full.

The same listing and entitlement model may also unlock access to non-static experiences such as paid livestream entry or paid replay access.

## Buyer Entitlement

In v0, the buyer receives a license/access entitlement.

This is not:

- copyright transfer
- full ownership of the underlying IP
- protocol-token payout

Interpretation:

- the buyer receives a recorded right to access and/or download the listed asset according to the listing terms
- the entitlement may later be represented by an app record, an onchain receipt, or a license token, but the product meaning stays the same

## Listing Model

Suggested v0 listing fields:

- `listing_id`
- `asset_id` nullable
- `live_room_id` nullable
- `guild_id`
- `seller_user_id`
- `listing_mode`
- `price_usd`
- `regional_pricing_policy` nullable
- `donation_opt_in`
- `donation_share_pct` nullable
- `donation_partner_id_snapshot` nullable
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `listing_mode`
  - `not_listed`
  - `listed`
- `status`
  - `active`
  - `paused`
  - `sold_out`
  - `removed`

Rules:

- v0 listings are fixed-price only
- a listing must target exactly one commerce object
- exactly one of `asset_id` or `live_room_id` must be non-null
- if `asset_id` is non-null, the listing belongs to exactly one asset
- if `live_room_id` is non-null, the listing belongs to exactly one live room
- an asset-targeted listing must not exist unless the asset is eligible for commerce
- a live-room-targeted listing must not exist unless the room is eligible for paid access
- `listing_mode` belongs to the listing object, not the post or asset
- `regional_pricing_policy`, when present, adjusts the buyer-visible USD quote before settlement
- donation settings belong to the listing object because creators may choose donation participation per sale surface
- donation may only be enabled when the guild donation policy allows it and the guild has an active donation partner
- when donation is enabled, `donation_partner_id_snapshot` captures the current guild donation partner for that listing
- `donation_opt_in` is a boolean in v0
- if `donation_opt_in = true`, then `donation_share_pct` and `donation_partner_id_snapshot` must be non-null
- if `donation_opt_in = false`, then `donation_share_pct = null` and `donation_partner_id_snapshot = null`

## Purchase Model

Suggested v0 purchase fields:

- `purchase_id`
- `listing_id`
- `asset_id` nullable
- `live_room_id` nullable
- `buyer_user_id`
- `purchase_price_usd`
- `pricing_tier` nullable
- `settlement_chain`
- `settlement_token`
- `settlement_tx_ref`
- `donation_partner_id` nullable
- `donation_share_pct` nullable
- `donation_amount_usd` nullable
- `donation_settlement_ref` nullable
- `created_at`

Rules:

- each purchase creates a buyer entitlement
- the purchase record is the canonical app-level record of the sale
- any onchain receipt or token should be treated as an implementation of the purchase/entitlement, not the only source of truth in v0
- `pricing_tier` captures the pricing tier applied to the buyer's final quote when regional pricing is active
- donation fields snapshot what donation routing, if any, actually applied at settlement time
- exactly one of `asset_id` or `live_room_id` must be non-null

## Regional Pricing

Pirate may support regional pricing in v0.

Reasoning:

- cost of living differs substantially across markets
- music guilds are global
- verified nationality gives Pirate a fairer and more abuse-resistant basis for pricing tiers than self-declared location

Recommended v0 model:

- list prices are authored as a base USD price
- a listing may optionally attach a `regional_pricing_policy`
- the buyer's effective USD quote is derived before settlement using the buyer's currently valid verified pricing tier

Important boundaries:

- regional pricing is a product-layer pricing rule, not a Story protocol primitive
- the Story-side settlement contract should receive the already-resolved purchase amount
- the contract should not be responsible for interpreting nationality or computing pricing tiers

Good defaults:

- regional pricing is optional, not mandatory, in v0
- tier derivation should come from current verification-backed pricing policy rather than ad hoc seller rules
- guilds may later override pricing policy only when governance hardens enough to support it safely

## Pricing And Settlement

V0 product assumptions:

- catalog prices are quoted in USD
- purchases execute on Story
- royalty-compatible onchain flows settle in the Story-supported revenue token required by the royalty path

Current practical implication:

- buyers should see USD pricing
- the protocol-side settlement token is an implementation detail
- the current Story royalty path should be assumed to require the currently supported Story revenue token for royalty-native flows unless protocol token support changes

Pirate should not make users think in protocol settlement tokens.

Implementation note:

- the current expected royalty-native settlement path on Story is `WIP`
- this is an implementation reality, not the primary user-facing pricing abstraction

## Settlement And Purchase Access

Marketplace settlement and purchase access control are separate, linked steps.

Settlement means:

- taking the buyer's final resolved purchase amount
- executing the sale on Story
- routing required upstream royalties and payout shares
- recording the successful purchase

Purchase/access control means:

- turning a successful purchase into the buyer's right to access the asset
- granting read access to locked payloads when required
- optionally minting or recording a receipt or entitlement artifact

In v0:

- settlement should happen on Story
- access control may be enforced through Pirate's content-access contracts and Story CDR-compatible condition flows when the asset is locked
- public assets may still create a purchase entitlement even when the content preview was already visible

## Routed Funding

V0 should support integrated routed funding.

Interpretation:

- a buyer may fund a purchase with a supported source asset on a supported source chain
- the app routes that value into the Story-side settlement token needed for execution
- the purchase contract then executes on Story

Implementation note:

- routed funding provider choice is not a protocol dependency in this spec
- Stargate, deBridge, and Orbiter are examples of possible implementation choices
- the spec does not require any single provider and should remain valid if routing providers change later

## Direct Payout Execution

V0 should use direct contract-mediated payout, not escrow and not platform custody.

Rules:

- the purchase transaction routes value directly into the active payout waterfall
- upstream royalty passthrough, if required, is handled as part of settlement
- guild and platform fees are routed immediately according to the active payout policy
- creator-side donation sidecars, when enabled, route to the guild's configured donation partner as part of settlement
- no platform treasury should hold buyer funds pending manual release in v0
- if a donation-enabled listing points to a paused or retired donation partner, the purchase must fail until the listing is refreshed or donation is disabled

Exception for flagged live-rights cases:

- if Pirate flags a live room or replay for manual rights review after ACRCloud analysis, rights-sensitive payout release may be delayed pending platform review resolution
- this is a narrow compliance exception, not a general escrow model for all purchases

This fits digital assets that deliver immediately after purchase.

## Delivery And Locked Assets

Listings may exist for both public and locked assets.

Rules:

- if `asset.access_mode = public`, the purchase may grant an explicit license/access record even if the asset was already publicly previewable
- if `asset.access_mode = locked`, the purchase should unlock the buyer's entitlement to the full payload
- post-level previews may remain public while the purchased full payload remains gated at the asset layer

This keeps feed UX social while letting premium content remain access-controlled.

For live-room-targeted listings:

- the entitlement unlocks room or replay access rather than a static downloadable payload
- delivery is enforced through live-room join or replay-access checks rather than generic asset download delivery
- when the purchased thing is a paid replay, the replay asset should be `access_mode = locked` and delivered through Pirate's CDR-compatible locked-asset path rather than a plain public media URL

## Sellability Rules

An asset is sellable in v0 only when:

- its rights path allows commerce
- upload analysis and moderation did not block commerce
- any required Story publication or derivative linkage is complete

Suggested v0 examples:

- original image asset
  - sellable
- original text asset
  - sellable
- original video asset
  - sellable
- original song asset in a permitted flow
  - sellable
- derivative remix without supported upstream rights path
  - not sellable

## Relationship To Monetization Policy

Marketplace execution uses the active payout policy defined in [monetization.md](./monetization.md).

Marketplace execution also uses the active guild donation policy defined in [donations.md](./donations.md) to determine whether listing-level donation opt-in is allowed.

That policy determines:

- creator share
- guild fee
- platform fee
- upstream royalty handling
- whether creator-side donation is enabled against the guild's configured donation partner

The marketplace spec does not redefine those percentages.

## On-chain vs Off-chain

Recommended v0 split:

- pricing, listings, purchases, and entitlements have app-level records
- purchase execution happens on Story
- direct payout settlement should be contract-mediated on Story
- routed funding may happen before Story execution, but is not itself the sale record
- pricing-tier resolution and regional pricing remain app-level before the onchain purchase executes

## Open Questions

- Which asset classes should be enabled for listing first in v0?
- Should v0 allow one listing per asset or multiple concurrent listings?
- Should a buyer entitlement be represented only by a purchase record in v0, or also by an onchain receipt token?
