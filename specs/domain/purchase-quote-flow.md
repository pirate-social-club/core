# Purchase Quote Flow

Status: draft

Related docs:

- [marketplace.md](./marketplace.md)
- [publish-matrix.md](./publish-matrix.md)
- [user.md](./user.md)
- [asset.md](./asset.md)
- [../contracts/locked-asset-delivery.md](../contracts/locked-asset-delivery.md)

## Purpose

This doc defines the offchain quote and price-resolution flow that feeds Pirate's Story-side purchase settlement contracts.

It covers:

- how base USD listing prices become buyer-specific quotes
- how verification-backed pricing tiers affect the quote
- what data is fixed before onchain settlement
- how the app-level quote maps to `MarketplaceSettlementV1`

## Core Principle

Pricing is resolved before chain execution.

Pirate contracts should consume a resolved purchase amount and purchase reference.
They should not compute nationality tiers, verification policy, or FX logic onchain.

## Non-Goals

This doc does not define:

- the exact FX provider
- exact fee-bps formulas for every listing type
- live donation routing internals
- secondary sales or resale quotes

## Quote Inputs

Recommended v0 quote inputs:

- `listing_id`
- `buyer_user_id`
- buyer's current `verification_capabilities`
- current pricing policy version
- current payout policy version
- requested settlement chain
- requested funding route, if routed funding is used

Relevant buyer capabilities may include:

- `nationality`
- `unique_human`
- optional future pricing-tier qualifiers

The provider model remains app-level.

Locked-in v0 rule:

- nationality-backed pricing tiers must derive from `verification_capabilities.nationality`
- in v0 that capability is available only from `self`
- if no accepted Self nationality proof exists, the quote must fall back to the authored base price
- Very may satisfy `unique_human` and other gate requirements without enabling nationality pricing

## Listing Price Source

The listing remains the source of authored commercial intent:

- `price_usd` is the authored base price
- `regional_pricing_policy`, when present, is a club-authored pricing policy that adjusts the buyer-visible quote

The quote service should never mutate the listing itself.

It should derive a quote snapshot from the listing plus buyer state.

## Suggested Quote Object

Recommended v0 app-level quote fields:

- `quote_id`
- `listing_id`
- `buyer_user_id`
- `asset_id` nullable
- `live_room_id` nullable
- `base_price_usd`
- `pricing_tier` nullable
- `final_price_usd`
- `settlement_chain`
- `settlement_token`
- `settlement_amount`
- `payout_destination`
- `donation_snapshot` nullable
- `entitlement_token_id`
- `asset_version_id`
- `expires_at`
- `pricing_policy_version`
- `payout_policy_version`
- `verification_snapshot_ref` nullable

Important v0 property:

- the quote is the canonical bridge between offchain pricing policy and onchain settlement inputs

Minimum pricing-audit expectation:

- `verification_snapshot_ref`, when present, should resolve to a snapshot that captures at least:
  - whether `verification_capabilities.nationality.state = verified`
  - the verified nationality value used, if any
  - the accepted provider used for pricing, which in v0 should be `self`
  - the derived `pricing_tier`
  - the `pricing_policy_version` applied

## Suggested Flow

Recommended v0 flow:

1. Buyer requests a quote for `listing_id`.
2. Pirate loads the active listing and verifies it is sellable.
3. Pirate loads the buyer's current verification-backed pricing inputs.
4. Pirate derives the applicable pricing tier, if any, from the club's active pricing policy.
5. Pirate computes `final_price_usd`.
6. Pirate resolves the Story-side settlement token and exact settlement amount.
7. Pirate resolves payout destinations and donation snapshot data.
8. Pirate resolves the locked asset delivery binding:
   - `asset_version_id`
   - `entitlement_token_id`
9. Pirate creates a short-lived quote record.
10. Buyer executes purchase using that quote.
11. Pirate or the settlement operator calls `MarketplaceSettlementV1.settlePurchase(...)` with the resolved purchase reference and amount.
12. Pirate records the canonical app-level `purchase` row from the successful settlement.

## Verification-Backed Pricing

Recommended v0 regional pricing model:

- seller authors a base USD price
- club pricing policy maps buyer verification state to a pricing tier
- pricing tier maps to a multiplier, band, or adjusted USD price

Examples:

- no verified nationality: base price only
- verified nationality in tier `regional_low`: discounted quote
- verified nationality in tier `regional_standard`: base quote
- verified nationality in a club-authored premium tier: increased quote above base price

Pricing control:

- pricing policy is club-controlled in v0, not platform-controlled
- Pirate may provide suggested default policies, including PPP-style defaults, but clubs may edit country-level outcomes fully
- the active pricing policy must be explicit, versioned, and auditable at quote time
- payout policy control and pricing policy control are separate

Important rule:

- the pricing tier is derived from current accepted verification state at quote time
- the contract does not re-check nationality onchain
- if the club does not support Self nationality proofs for commerce, nationality-tiered pricing must be disabled for that club

## Quote Expiry

Recommended v0 posture:

- quotes should expire quickly
- expired quotes must not be accepted for settlement

Reasoning:

- verification-backed pricing may change
- payout policy may change
- routed funding amounts and swap outputs are time-sensitive

The settlement contract does not need to enforce quote expiry itself in v0 if the settlement operator only submits live quotes, but the app-level purchase flow must.

## Mapping To `MarketplaceSettlementV1`

Current contract boundary:

- `purchaseRef` maps to the quote or purchase correlation identifier
- buyer is the resolved recipient of the entitlement
- `tokenId` is the entitlement class for the locked asset version
- payout recipient is resolved before submission
- the native amount sent in the transaction is the resolved settlement amount

In other words:

- pricing logic stays offchain
- entitlement class selection stays offchain
- contract execution is the narrow finalizer

## Purchase Record Snapshot

After successful settlement, Pirate should write an app-level purchase row that snapshots:

- `purchase_id`
- `listing_id`
- `buyer_user_id`
- `purchase_price_usd`
- `pricing_tier`
- `settlement_chain`
- `settlement_token`
- `settlement_tx_ref`
- `entitlement_token_id`
- `asset_version_id`
- any donation routing fields used

This keeps the app DB as the canonical analytical and support surface even when the entitlement is also onchain.

## Failure Rules

Recommended v0 rules:

- if quote generation fails, no onchain purchase should start
- if settlement fails, no purchase row should become final
- if settlement reverts, entitlement minting should not persist
- if quote expires before submission, the buyer must request a new quote

## Contract Boundary Summary

Offchain:

- verification-backed pricing tier derivation
- nationality interpretation
- USD pricing
- settlement-token amount resolution
- payout-destination resolution
- quote issuance and expiry

Onchain:

- purchase finalization
- payout execution
- entitlement mint

## Open Questions

- Should v0 quotes be signed app-side before submission to the settlement operator?
- Should routed-funding slippage tolerance be embedded in the quote object or treated as transport-layer execution metadata?
