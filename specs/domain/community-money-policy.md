# Community Money Policy

Status: draft

Related docs:

- [community.md](./community.md)
- [governance-backends.md](./governance-backends.md)
- [monetization.md](./monetization.md)
- [marketplace.md](./marketplace.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)

## Purpose

This doc defines how a community expresses its funding preferences for commerce without turning the community object itself into a chain or route object.

It covers:

- the difference between community money identity and purchase execution
- the attached money-policy object for a community
- funding-asset and route constraints for purchases
- route viability requirements at quote time
- treasury denomination considerations

## Non-goals

This doc does not define:

- a Pirate-operated DEX or market maker
- a universal route graph across every chain and token
- Bitcoin-native or chain-native asset unlocking
- treasury auto-swap implementation details

## Core Principle

A community may express a preferred funding identity without owning the final execution rail.

This means:

- community identity remains anchored on `community_id`
- purchase execution may still happen on Story
- locked-asset access may still be granted through Story entitlement plus Story CDR
- Pirate may restrict a community's commerce funding lane to a narrow set of supported external routes

Important boundary:

- a community is not itself a route, bridge, DAO, or chain object
- money and route behavior should therefore live on an attached policy record, not as direct community identity fields

## Naming Guidance

`native currency` is too broad for v0 when a community may prefer one asset socially but only support a narrower executable funding lane.

Recommended v0 language:

- `funding_preference`
- `accepted_funding_assets`
- `accepted_source_chains`
- `approved_route_providers`

Avoid using `native currency` in purchase contexts unless the same asset is also the actual executable settlement and unlock rail.

## Attached Policy Model

Recommended v0 shape:

- `community_money_policy_id`
- `community_id`
- `funding_preference`
- `accepted_funding_assets`
- `accepted_source_chains`
- `approved_route_providers`
- `destination_settlement_chain`
- `destination_settlement_token`
- `treasury_denomination`
- `max_slippage_bps`
- `quote_ttl_seconds`
- `route_required`
- `route_status_policy`
- `route_hop_tolerance`
- `created_at`
- `updated_at`

Recommended interpretation:

- `funding_preference`
  - the user-facing asset family or money identity the community prefers
- `accepted_funding_assets`
  - the actual executable source assets Pirate may quote against
- `accepted_source_chains`
  - the source chains from which those accepted funding assets may originate
- `approved_route_providers`
  - the external route venues Pirate is willing to support for this community's purchases
- `destination_settlement_chain`
  - the chain on which purchase execution happens
- `destination_settlement_token`
  - the asset required by the destination execution path
- `treasury_denomination`
  - the asset the community expects treasury reporting or proceeds to anchor on
- `max_slippage_bps`
  - the maximum tolerated routed-funding slippage for quote execution
- `quote_ttl_seconds`
  - how long a route-backed quote remains valid
- `route_required`
  - whether the community requires an approved external funding route for purchase
- `route_status_policy`
  - how Pirate behaves when no approved route is currently viable
- `route_hop_tolerance`
  - the maximum intermediate-hop complexity Pirate is willing to support

Recommended storage posture:

- `accepted_funding_assets`, `accepted_source_chains`, and `approved_route_providers` may be modeled as normalized child rows or structured JSON depending on implementation needs
- the important property is that the policy remains an attached record owned by the community, not a mutation of community identity itself

## Funding Preference vs Executable Funding Asset

The user-facing money identity may be broader than the executable funding asset.

Example:

- `funding_preference = BTC`
- `accepted_funding_assets = [cBTC]`
- `accepted_source_chains = [Citrea]`

Interpretation:

- the community identifies economically with Bitcoin
- Pirate does not claim broad raw-Bitcoin purchase support
- Pirate only supports the narrower executable lane represented by `cBTC` on Citrea

This keeps the product honest:

- broad money identity may be social
- executable funding support must remain concrete and route-backed

## Supported Commerce Posture

Recommended v0 split:

- buyer funding may begin on an external chain and asset
- external routing happens outside Pirate's protocol surface
- purchase execution still happens on the destination settlement chain
- entitlement mint and locked-asset unlock still follow the destination execution path

For current Story-native purchase flows this means:

- buyers may fund with a supported external asset
- an approved external venue routes that value into the Story-side settlement token
- Story purchase execution mints the entitlement
- Story CDR checks the Story entitlement state for locked access

Pirate should not imply that the funding asset itself performs the unlock.

## Phased Funding-Lane Support

Funding-lane support should expand honestly and in narrow executable slices.

Recommended rollout:

- phase 1
  - EVM funding lanes into Story-side settlement
  - narrow approved route-provider set
  - honest user-facing support posture centered on Ethereum, Base, and Story-linked purchase execution
- phase 1.5
  - Tempo may be added as a payment or funding lane once Pirate has a concrete mapping from Tempo-side payment success into the same purchase-quote and Story-settlement flow
  - until that mapping exists, Pirate should not present Tempo as a fully general wallet-family equivalent to EIP-155 support
- deferred
  - Solana funding lanes
  - Bitcoin-native funding lanes

Important posture:

- the wallet hub may become first-class before every funding family is supported
- missing Solana or Bitcoin support should not block EVM-first commerce if Pirate states the narrower support claim clearly
- broader social funding preference labels such as `BTC` remain acceptable only when the executable lane is specified honestly

Example honest phased posture:

- `funding_preference = BTC`
- current executable lane = routed EVM funding into Story settlement
- future executable lane may later include a narrower Bitcoin-related source asset such as wrapped or bridged BTC, but Pirate should not imply raw Bitcoin-native purchase support before that path exists

## Route Viability

Route viability is a purchase precondition, not a post-condition.

Recommended v0 rule:

- if `route_required = true`, Pirate must not issue a purchase quote unless at least one approved route from an accepted funding asset to the destination settlement token is viable at quote time

Minimum route viability expectation:

- source asset supported
- source chain supported
- route provider allowed by policy
- expected destination amount satisfies the quote requirement
- estimated slippage is within `max_slippage_bps`
- route complexity is within `route_hop_tolerance`
- route TTL is compatible with `quote_ttl_seconds`

Recommended result:

- route viable: quote may be issued
- route unavailable: no executable quote should be issued for that funding lane

## Suggested Invariants

Recommended v0 invariants:

1. if `route_required = true`, `accepted_funding_assets` must be non-empty
2. every accepted funding asset must have at least one currently supported source-chain pairing
3. `approved_route_providers` must be non-empty when `route_required = true`
4. `destination_settlement_chain` and `destination_settlement_token` must be explicit
5. Pirate must reject a policy whose funding lane has no viable route graph to the destination settlement token
6. if community governance is chain-attached, the money policy must not silently contradict that governance context without explicit product support

## Route Status Policy

Suggested v0 values:

- `fail`
- `fallback_display`
- `queue`

Recommended interpretations:

- `fail`
  - purchases using the community funding lane are unavailable while the route is down
- `fallback_display`
  - Pirate may show an alternative supported direct-funding or other-funding option if one exists
- `queue`
  - reserved for later flows where delayed execution is operationally acceptable; not recommended for immediate-access digital purchases in v0

Recommended v0 default:

- `fail`

Immediate digital purchases should not enter an ambiguous routed-funding limbo by default.

## Treasury Denomination

Buyer funding, settlement execution, and treasury denomination are separate concerns.

This means:

- a buyer may fund with one asset
- settlement may execute in another asset
- the community may still conceptually measure treasury in a third denomination

Recommended v0 rule:

- `treasury_denomination` should be explicit so the community can reason about whether settlement proceeds match its expected treasury unit

Important boundary:

- this doc does not require an automatic treasury-side swap from destination settlement token into the preferred treasury denomination
- if no such swap exists, Pirate should expose denomination drift clearly in admin and treasury reporting surfaces

## Failure Rules

Recommended v0 rules:

- if no approved route is viable at quote time, do not issue the quote
- if the route estimate exceeds `max_slippage_bps`, do not issue the quote
- if the route requires more hops than `route_hop_tolerance`, do not issue the quote
- if the quote expires before final purchase submission, settlement must not proceed
- if routed funding completes but Story settlement fails, the purchase must remain non-final and operator recovery procedures must be explicit
- if settlement fails to mint or assign the entitlement, locked-asset access must not appear granted

The app should model route-backed purchases as a state machine with explicit operator-observable failure states rather than a single opaque "payment failed" bucket.

## Example: Bitcoin-Family Community

An honest v0 Bitcoin-family configuration may look like:

- `funding_preference = BTC`
- `accepted_funding_assets = [cBTC]`
- `accepted_source_chains = [Citrea]`
- `approved_route_providers = [stargate]`
- `destination_settlement_chain = Story`
- `destination_settlement_token = WIP`
- `treasury_denomination = WIP`
- `route_required = true`
- `route_status_policy = fail`

Interpretation:

- the community identifies with Bitcoin
- Pirate only supports the narrower executable `cBTC` funding lane
- Pirate does not claim generic Bitcoin L1 or Lightning purchase support
- purchases fail closed if the approved Citrea-to-Story route is unavailable

## User-Facing Copy Guidance

Recommended purchase-facing language:

- "Purchases in this community are funded with cBTC on Citrea."
- "Settled on Story" may appear in advanced transaction detail.

Avoid:

- "Bitcoin-native purchase" when only `cBTC` on Citrea is supported
- "native currency" as the main purchase label
- route- or sovereignty-jargon in ordinary buyer UI

Recommended admin-facing language:

- "Funding preference"
- "Accepted funding assets"
- "Approved route providers"
- "Treasury denomination"

## Open Questions

- Should Pirate treat route-provider approval as community-configurable, platform-configurable, or both?
- Should treasury denomination be only a reporting preference in v0, or should it later drive automated treasury conversion policy?
- Should communities be allowed to declare a broad funding preference when the only executable lane is a narrower wrapped or bridged asset?
