# Story Royalty Commerce

Status: implemented for testnet commerce; mainnet provider execution deferred

Related docs:

- [asset.md](./asset.md)
- [monetization.md](./monetization.md)
- [royalty-graph.md](./royalty-graph.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [donations.md](./donations.md)
- [marketplace.md](./marketplace.md)

## Purpose

This doc defines Pirate's Story Royalty Module native commerce path for sellable rights-bearing assets.

It covers:

- how sellable Story assets should register royalty-native state
- how original and derivative sales should enter Story royalty flow
- where charity applies relative to the Story royalty graph
- how Pirate should sequence the migration across repos

## Decision

Pirate should use Story's Royalty Module as the mainline revenue path for commerce assets that participate in Story-native rights and derivative behavior.

This is required because:

- songs are rights-bearing Story assets in v0
- remix songs are first-class product behavior
- videos are expected to reference songs heavily
- derivative obligations are a core product requirement, not a later edge case

Story should be the source of truth for upstream derivative royalty enforcement.

Pirate should not keep a parallel primary settlement model for derivative revenue obligations once Story-native royalty commerce is active.

## Charity Model

Charity remains a listing-level choice, not a permanent IP-level ownership setting.

Rules:

- community chooses the donation partner
- creator chooses `donation_share_pct` per listing
- charity is deducted from the gross resolved sale amount before the remaining revenue is paid into Story's royalty graph
- the Story royalty graph receives the net amount after charity

This means Pirate should use quote-time gross-to-charity/net-to-Story routing, not permanent royalty-token allocation, for v0 charity behavior.

Interpretation:

- Pirate resolves gross sale price and listing-specific charity amount
- Pirate routes the charity leg to the configured partner
- Pirate pays the remaining net amount into Story via the Royalty Module
- Story resolves derivative obligations over that net amount

## Payment Token

Story royalty-native sales should use the Story-supported royalty payment token rather than the current native-value settlement path.

Rules:

- royalty-native commerce sales should settle in `WIP`
- routed buyer funding should deliver the buyer-facing source asset, currently USDC, to Pirate checkout
- Pirate checkout pays the net WIP amount into the royalty-native Story path after buyer funding is verified
- quote and purchase records for royalty-native sales should record `settlement_token = WIP`
- current native-value `MarketplaceSettlementV1` assumptions are transitional only and must not be treated as the target path for Story RM commerce

Implementation warning:

- engineers should not assume the current native-value settlement call can become royalty-native by changing only the target contract call
- the buyer funding lane, settlement token, and settlement execution model all change when moving to Story RM

## Current Implementation Boundary

The mainline asset commerce path is Story RM native.

Current state:

- assets store `story_ip_id`
- Story publish configures entitlement and asset publication for locked assets
- publish attempts Story royalty registration for original and derivative assets
- asset listing activation requires completed Story royalty registration
- asset purchase quotes snapshot `settlement_mode = royalty_native_story_payment`
- asset purchase quotes expose the buyer checkout destination and the net WIP amount Pirate will pay into Story
- asset purchase settlement requires a confirmed buyer funding transaction before charity or Story effects execute
- asset purchase settlement routes charity first, then pays the net creator-side amount into Story RM
- external settlement effects are recorded in `purchase_settlement_effects` before execution and confirmed after provider/Story success
- retries reuse confirmed buyer funding, charity, Story royalty, and entitlement effects instead of silently changing purchase identity

Current implementation files:

- `api/services/api/src/lib/story/story-publish-service.ts`
- `api/services/api/src/lib/story/story-royalty-registration-service.ts`
- `api/services/api/src/lib/story/story-royalty-settlement-service.ts`
- `api/services/api/src/lib/communities/community-commerce-settlement-service.ts`

While Story CDR is still on Aeneid, all executable commerce environments should remain testnet. Real-money provider rails such as Endaoment mainnet execution stay deferred until the Story/CDR settlement path is also mainnet.

## Required Story-Native Flow

### Original Work

1. Creator publishes a sellable Story asset.
2. Pirate registers the IP asset and attaches the selected Story royalty policy.
3. Buyer-side sale resolves gross price and any listing-level charity amount.
4. Pirate routes the charity leg to the configured partner when enabled.
5. Pirate pays the remaining net revenue into Story royalty flow.
6. Story records revenue for that IP.
7. Entitlement and CDR access remain bound to the purchase record.

### Derivative Work

1. Creator publishes a downstream Story IP with derivative linkage to upstream IP.
2. Pirate registers the derivative relationship and required royalty behavior on Story.
3. Buyer-side sale resolves gross price and any listing-level charity amount.
4. Pirate routes the charity leg to the configured partner when enabled.
5. Pirate pays the remaining net revenue into Story royalty flow.
6. Story resolves ancestor obligations according to the derivative graph and royalty policy.
7. Entitlement and CDR access remain bound to the purchase record.

## Entitlement Timing

Buyer entitlement should be granted when the sale payment succeeds on the Story royalty-native path and the required quote-time payout legs have been recorded.

Rules:

- buyer entitlement is granted immediately after the Story-side sale payment succeeds
- creator claim happens asynchronously after the sale through Story's normal royalty claim flow
- charity routing is part of the gross-to-net settlement path and is tracked on the purchase allocation leg
- buyer CDR unlock is gated by the purchase record and entitlement, not by later creator claim completion

This preserves the current user-facing purchase model while keeping Story as the source of truth for derivative royalty distribution.

## Buyer Checkout And Route-Output Receipt

Royalty-native settlement is not allowed to execute against an implicit operator balance, but buyers should not pay in WIP.

Rules:

- the buyer checkout surface presents supported source assets such as USDC or ETH
- the approved checkout route receives the buyer-facing source payment into the checkout operator
- the quote includes the source-chain checkout address the buyer must pay
- the quote includes the net WIP amount Pirate will pay into Story settlement
- `funding_tx_ref` references the buyer source-payment transaction
- the server verifies the confirmed source-asset transfer before charity or Story payout effects execute
- the checkout operator is responsible for operational source-asset-to-Story-liquidity reconciliation
- direct buyer WIP payment is not a mainline purchase path

This keeps settlement deterministic: the quote defines the gross amount, charity is deducted from that gross amount, and only the net amount enters Story RM.

## Ordering Constraint

Required ordering:

1. buyer pays
2. external network/payment fees are removed
3. listing-level charity is deducted from the gross sale amount when enabled
4. the remaining net amount is paid into Story Royalty Module
5. Story-native upstream royalty obligations are resolved
6. remaining creator-side proceeds become claimable through Story

This ordering is already assumed by:

- [monetization.md](./monetization.md)
- [royalty-graph.md](./royalty-graph.md)
- [donations.md](./donations.md)

## Story-Native Commerce Requirements

Story RM commerce has three protocol requirements. These are the current mainline requirements for asset commerce, not optional fallback behavior.

### 1. IP Registration And Royalty Policy Attachment

Every sellable Story-native commerce asset must have:

- `story_ip_id`
- royalty policy attachment metadata
- derivative linkage metadata when applicable

Pirate must register or confirm this state during publish before commerce can activate.

Current status:

- implemented in `pirate-api` for original and derivative song assets
- listing activation, quote creation, and settlement all reject assets that are not registered

### 2. Royalty-Native Payment Path

Pirate must support the Story royalty payment token and the flow required by `payRoyaltyOnBehalf`.

The current native-value single-recipient settlement path is insufficient for royalty-native sales.

Current status:

- implemented for asset commerce as `settlement_mode = royalty_native_story_payment`
- buyer checkout remains source-asset based, currently USDC on the configured Pirate checkout chain
- Pirate verifies buyer funding and pays the quote's net WIP amount into Story

### 3. Gross-To-Net Charity Routing

Because charity is listing-level, Pirate must support quote-time charity allocation and settlement-time routing before the net revenue enters Story.

That routing path must be auditable and must preserve the quote-time donation snapshot.

Current status:

- quote snapshots are the settlement source of truth
- charity settlement effects are durable and idempotent
- real Endaoment execution is blocked until commerce is on mainnet rails

## Repo Workplan

### Phase 1. Specification Lock

Status: done

Owner:

- parent repo `specs/domain`
- `specs/api`

Work:

- define the Story RM migration contract in specs
- define publish-time prerequisites for sellable Story assets
- define settlement semantics for original vs derivative sales
- define gross-to-net charity routing semantics for listing-level charity

Primary outputs:

- this doc
- updates to `asset.md`, `purchase-quote-flow.md`, `monetization.md`, `marketplace.md`
- API contract changes for royalty-native settlement metadata

### Phase 2. Story Publish Upgrade

Status: done for song assets on the current Story Aeneid path

Owner:

- `pirate-api`

Work:

- upgrade Story publish flow so sellable assets register the needed royalty-native state
- store royalty policy metadata on the asset record
- store derivative linkage metadata needed for Story registration when `rights_basis = derivative`

Likely files:

- `services/api/src/lib/story/story-publish-service.ts`
- `services/api/src/lib/communities/community-commerce-service.ts`
- `services/api/src/lib/song-artifacts/*`

### Phase 3. Settlement Model Refactor

Status: done for creator plus charity allocation legs; platform and community treasury legs remain additive future legs

Owner:

- `pirate-api`

Work:

- keep asset commerce on the royalty-native settlement path
- keep royalty-native sale execution metadata on quote and purchase records
- extend allocation-leg state as platform and community treasury legs become active

Likely files:

- `services/api/src/lib/communities/community-commerce-quote-service.ts`
- `services/api/src/lib/communities/community-commerce-settlement-service.ts`
- `services/api/src/lib/story/story-royalty-settlement-service.ts`
- DB migrations for quote, purchase, and allocation-leg metadata

### Phase 4. Charity Routing And Receipts

Status: testnet-safe execution boundary implemented; real Endaoment payout execution deferred until mainnet

Owner:

- `pirate-api`

Work:

- apply listing-level donation percentage to the gross resolved sale amount
- route the charity amount to the configured donation partner before net Story payment
- persist provider receipts and tax receipt references

Likely files:

- new `services/api/src/lib/communities/community-commerce-charity-payout-service.ts`
- donation partner payout integration code

### Phase 5. Buyer Runtime And UX

Status: buyer checkout metadata is exposed by API; frontend purchase UX remains the next integration surface

Owner:

- `pirate-web`

Work:

- keep buyer quote UI aligned with Story-native settlement
- show pricing tier, creator donation split, and purchase processing states
- preserve CDR unlock behavior while settlement and claim finalize

Likely files:

- authenticated purchase routes and presentation
- buyer purchase status polling
- unlock status UX

## Implemented Commerce Boundary

Backend asset commerce now follows these boundaries:

- quote and purchase records include explicit royalty-native settlement metadata
- sellable assets store Story royalty policy and derivative registration metadata
- asset listing activation fails when the asset lacks Story royalty registration state
- asset settlement fails when an asset quote is not royalty-native
- `MarketplaceSettlementV1` is not used for asset commerce

This gives Pirate a clean transition boundary: asset commerce cannot silently bypass Story royalty prerequisites.

## Mainnet Revisit Checklist

When Story CDR and commerce move off Aeneid/testnet, revisit these items before enabling real-money settlement:

- set hosted checkout environments to the intended real source chain, e.g. Base mainnet USDC
- configure the Story mainnet royalty addresses and WIP token path
- configure Endaoment mainnet registry, USDC token, RPC, and payout signer
- confirm the checkout operator has operational source-asset-to-WIP liquidity
- run an end-to-end original sale, derivative sale, charity sale, and retry/reconciliation test on mainnet-like infrastructure
- update this status line from "mainnet provider execution deferred" to the active mainnet posture

## Explicit Non-Goals For This Phase

This phase should not:

- invent a parallel off-Story settlement backend as the mainline path
- treat charity as a permanent royalty-token ownership split
- pay the gross sale amount into Story when the quote contains a charity leg
- pretend current `MarketplaceSettlementV1` is Story royalty-native

## Settlement Recovery

Settlement uses a stable purchase identity derived from the quote id before any external effect.

Rules:

- `purchaseRef` must be stable across retries for the same quote
- charity payout, Story royalty payment, and locked entitlement mint are recorded as explicit settlement effects
- a confirmed effect must not be executed again on retry
- Story royalty payment is recorded separately from entitlement mint because entitlement minting can fail after revenue payment
- buyer entitlement is still only written to the app purchase record after required external effects have succeeded
