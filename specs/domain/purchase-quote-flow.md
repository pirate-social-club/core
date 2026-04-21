# Purchase Quote Flow

Status: implemented for Story royalty-native asset commerce on testnet rails

Related docs:

- [marketplace.md](./marketplace.md)
- [community-money-policy.md](./community-money-policy.md)
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
- how the app-level quote maps to the active Story royalty-native payment path
- how the buyer's wallet path continues through Story-side entitlement unlock

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
- current community money policy, when routed funding is enabled

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
- `funding_asset` nullable
- `funding_chain` nullable
- `route_provider` nullable
- `route_available`
- `settlement_chain`
- `settlement_token`
- `settlement_amount`
- `settlement_mode`
- `payout_destination`
- `allocation_snapshot[]`
- `entitlement_token_id`
- `asset_version_id`
- `expires_at`
- `pricing_policy_version`
- `payout_policy_version`
- `verification_snapshot_ref` nullable

Important v0 property:

- the quote is the canonical bridge between offchain pricing policy and onchain settlement inputs
- `allocation_snapshot[]` is the canonical bridge between offchain payout policy and downstream settlement execution

Allocation snapshot rules:

- `allocation_snapshot[]` is resolved once at quote time and must not be recomputed from current listing or community settings during settlement
- each allocation entry should include:
  - `recipient_type`
  - `recipient_ref` nullable
  - `waterfall_position`
  - `share_bps`
  - `amount_usd`
  - `settlement_strategy`
- `share_bps` uses integer basis points
- the snapshot must include exactly one creator leg
- total `share_bps` across the snapshot must equal `10000`
- non-remainder legs round first; creator receives the remainder

Settlement mode meanings:

- `delivery_only_story_settlement`
  Non-royalty asset delivery or future non-asset settlement path. This must not be used for sellable asset commerce.
- `royalty_native_story_payment`
  Story Royalty Module path using the Story-supported royalty payment token

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
6. Pirate loads the active community money policy when routed funding is required or requested.
7. Pirate resolves the Story-side settlement token and exact settlement amount.
8. Pirate checks whether at least one approved route from an accepted funding asset to the destination settlement token is viable within the current money-policy constraints.
9. If no approved route is viable, Pirate must not issue an executable quote for that funding lane.
10. Pirate resolves payout destinations and the allocation snapshot.
11. Pirate resolves the locked asset delivery binding:
   - `asset_version_id`
   - `entitlement_token_id`
12. Pirate creates a short-lived quote record.
13. Buyer executes purchase using that quote.
14. Pirate or the settlement operator executes the sale on the active Story settlement path.
15. If the sale is royalty-native and the quote contains charity, the charity leg is deducted from gross and the net amount is paid into Story.
16. Buyer entitlement is granted after the Story-side sale payment succeeds; later creator claim continues asynchronously through Story.
17. Pirate records the canonical app-level `purchase` row from the successful settlement.

## Payment Token

Royalty-native Story commerce should use the Story-supported royalty payment token.

Rules:

- royalty-native sales should settle in `WIP`
- routed buyer funding should deliver the buyer-facing source asset, currently USDC, to Pirate checkout
- Pirate checkout pays the net WIP amount into Story after buyer funding is verified
- the current native-value settlement path should be treated as transitional and not reused implicitly for royalty-native commerce
- sellable asset quotes must use `royalty_native_story_payment`
- quote and purchase records should make the active settlement mode explicit so downstream services do not confuse delivery-only settlement with royalty-native settlement

## Buyer-Facing Wallet Path

Quote issuance and locked-asset unlocking should feel like one continuous path to the buyer even though they cross app, route-provider, and Story boundaries.

Recommended v0 user-visible sequence:

1. Buyer opens a paid asset or paid replay.
2. Pirate checks for an eligible EIP-155 wallet path for settlement.
3. If no eligible settlement wallet is available, Pirate returns a wallet-required state and deep-links to the wallet hub.
4. Buyer requests a quote for the listing and chosen funding lane.
5. Pirate validates the funding lane against the active community money policy.
6. If the funding lane is executable, Pirate issues the quote and required Story-side settlement lane.
7. Buyer completes any required routed-funding step.
8. Pirate or the operator finalizes Story settlement using the resolved settlement wallet path.
9. If the quote uses the royalty-native Story path, charity is deducted from gross before net Story payment, and creator claim continues asynchronously.
10. Pirate records the purchase and entitlement snapshot.
11. The paid asset then moves from purchase-eligible to unlock-eligible for that buyer wallet path.

Important user-facing rule:

- the wallet used for Story settlement must remain legible to the buyer
- if Pirate later supports explicit settlement-wallet selection, the chosen wallet must be shown before execution rather than inferred opaquely
- if the quote uses the royalty-native Story path, the user should not be told that creator claim must complete before access unlocks

## Story CDR Unlock Path

Locked Story delivery should have a clear post-purchase read path rather than treating purchase and playback as unrelated surfaces.

Recommended v0 unlock flow:

1. Buyer requests access to a locked asset after purchase.
2. Pirate resolves whether the asset is delivered through direct app storage or Story CDR.
3. If direct app delivery applies, Pirate may return the ordinary protected delivery ref.
4. If Story CDR applies, Pirate must return a short-lived access package bound to the resolved locked asset version and buyer entitlement context.
5. The client must use a connected eligible EIP-155 wallet to satisfy the Story read condition and read or decrypt the payload.
6. If the connected wallet does not match the entitled wallet path, Pirate should return a switch-wallet or reconnect-wallet state rather than a generic playback failure.
7. If the entitlement is not yet final, Pirate should return a settlement-pending state rather than treating the purchase as absent.

Recommended v0 Story CDR access-package contents:

- the locked asset version binding
- the vault or namespace binding needed for the CDR read
- the buyer entitlement binding
- expiry information for the short-lived read authorization
- any additional proof material needed by the Story-side read path

Important boundary:

- the funding asset or source chain does not perform the unlock
- routed funding is only the way value reaches the Story-side settlement lane
- the actual locked read path remains Story entitlement plus Story CDR access
- the encrypted asset payload is not re-authored per pricing tier; the quote changes price, not the locked content binding

## Unlock Failure States

The app should distinguish commerce failure from read-path failure.

Recommended v0 states:

- `wallet_required`
  - no eligible settlement or read wallet is available
- `route_unavailable`
  - the requested funding lane is not executable under the active money policy
- `settlement_pending`
  - value movement started but Story-side finalization or entitlement projection is not yet confirmed
- `unlock_wallet_mismatch`
  - the buyer has an entitlement, but the currently connected wallet is not the wallet path needed for the read
- `unlock_failed`
  - the Story CDR read path failed for a reason other than missing entitlement or wrong wallet

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

Recommended routed-funding rule:

- route viability is a quote precondition, not a post-condition
- if the route estimate exceeds the active money-policy slippage tolerance, Pirate must not issue the quote
- if the route requires more intermediate complexity than the active money policy allows, Pirate must not issue the quote

## Mapping To `MarketplaceSettlementV1`

Current contract boundary:

- `purchaseRef` maps to the quote or purchase correlation identifier
- buyer is the resolved recipient of the entitlement
- `tokenId` is the entitlement class for the locked asset version
- payout recipient is resolved before submission
- the native amount sent in the transaction is the resolved settlement amount

Current implementation note:

- `MarketplaceSettlementV1` is still a single-recipient settlement primitive
- `MarketplaceSettlementV1` must not be used for sellable asset commerce
- multi-leg app-level allocations may therefore contain legs that are not yet confirmed onchain in the same step
- the quote snapshot remains canonical even when execution backends differ by allocation leg
- `MarketplaceSettlementV1` should be treated as transitional for non-royalty delivery settlement only, not as the target primitive for Story Royalty Module commerce

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
- `allocation_snapshot[]` as executed purchase legs
- compatibility donation fields, when present

This keeps the app DB as the canonical analytical and support surface even when the entitlement is also onchain.

## Failure Rules

Recommended v0 rules:

- if quote generation fails, no onchain purchase should start
- if a routed-funding community has no viable approved route at quote time, no executable quote should be issued
- if settlement fails, no purchase row should become final
- if settlement reverts, entitlement minting should not persist
- if quote expires before submission, the buyer must request a new quote
- if routed funding completes but settlement does not finalize, the purchase must remain non-final and recovery handling must be explicit at the operator layer

## Contract Boundary Summary

Offchain:

- verification-backed pricing tier derivation
- nationality interpretation
- USD pricing
- settlement-token amount resolution
- payout-destination resolution
- quote issuance and expiry
- locked-read authorization packaging
- wallet-required and switch-wallet state resolution

Onchain:

- purchase finalization
- payout execution
- entitlement mint
- locked-read condition enforcement

## Open Questions

- Should v0 quotes be signed app-side before submission to the settlement operator?
- Should routed-funding slippage tolerance be embedded in the quote object or treated as transport-layer execution metadata?
