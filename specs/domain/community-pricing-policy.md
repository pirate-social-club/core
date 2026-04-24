# Community Pricing Policy

Status: current working spec

Related docs:

- [marketplace.md](./marketplace.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [community-money-policy.md](./community-money-policy.md)
- [user.md](./user.md)

## Purpose

This doc defines the community-owned pricing policy that resolves buyer-specific USD quote adjustments before settlement.

It covers:

- how community-controlled regional pricing is modeled
- how nationality-backed pricing derives from verification state
- precedence between platform defaults, community policy, and listing opt-in
- the minimum storage and API shape needed to make quote pricing auditable

## Non-goals

This doc does not define:

- funding-lane routing or bridge policy
- settlement-token execution details
- FX-provider internals
- donation routing

Those remain separate from pricing policy.

## Core Principle

Pricing policy is a community commerce policy, not a funding policy.

This means:

- `money policy` controls which buyer funding lanes and routes are allowed
- `pricing policy` controls how an authored USD listing price may be adjusted for a buyer before quote issuance
- the purchase quote consumes both policies, but they must remain separate records

## Precedence

Recommended v0 precedence:

1. Pirate may publish default pricing templates.
2. A community may explicitly adopt or edit one of those templates into its own active pricing policy.
3. The active community pricing policy is authoritative for future quotes in that community.
4. A listing may opt in to regional pricing, but it should not carry its own hidden country table in v0.
5. If no explicit community pricing policy exists, the effective pricing policy resolves to `policy_origin = default` and regional pricing must be disabled.

Important implication:

- platform defaults are advisory starting points, not authoritative country outcomes
- community explicit policy always wins for that community
- listing state only determines whether the listing uses the active policy

## Verification Source

Locked v0 rule:

- nationality-backed pricing may derive only from `verification_capabilities.nationality`
- in v0 that capability is valid for pricing only when `provider = self`
- if the buyer lacks a current accepted Self nationality proof, the quote must fall back to base price
- Very or other providers may satisfy anti-sybil or membership requirements without enabling nationality-tiered pricing

## Recommended Policy Shape

Recommended resolved policy fields:

- `community_id`
- `policy_origin`
- `pricing_policy_version`
- `regional_pricing_enabled`
- `verification_provider_requirement`
- `default_tier_key`
- `tiers`
- `country_assignments`
- `source_template_id` nullable
- `source_template_version` nullable
- `updated_at`

Field meanings:

- `policy_origin`
  - `default` means no explicit community pricing policy exists; the server returns a resolved fallback policy with regional pricing disabled
  - `explicit` means the community has authored or adopted an active pricing policy
- `pricing_policy_version`
  - monotonically changes whenever the explicit community pricing policy changes
- `regional_pricing_enabled`
  - whether listings that opt in may apply nationality-tiered pricing
- `verification_provider_requirement`
  - v0 should be `self` whenever regional pricing is enabled
- `default_tier_key`
  - the tier used when a verified nationality exists but no explicit country assignment is present
- `tiers`
  - named pricing outcomes such as `regional_low`, `regional_standard`, or `regional_premium`
- `country_assignments`
  - explicit ISO country code to tier mapping
- `source_template_id`, `source_template_version`
  - optional traceability back to a platform-suggested template

## Tier Model

Recommended v0 tier shape:

- `tier_key`
- `display_name`
- `adjustment_type`
- `adjustment_value`

Suggested `adjustment_type` values:

- `multiplier`
- `fixed_price_usd`

Interpretation:

- `multiplier`
  - multiply the authored base USD price by `adjustment_value`
- `fixed_price_usd`
  - ignore multiplier math and quote the fixed USD amount directly

Recommended v0 invariants:

1. `tier_key` values must be unique within a policy
2. `adjustment_value` must be non-negative
3. at least one tier must exist when `regional_pricing_enabled = true`
4. `default_tier_key` must reference an existing tier when non-null
5. every `country_assignments.tier_key` must reference an existing tier
6. if `regional_pricing_enabled = true`, `verification_provider_requirement` must be `self`

## Listing Integration

Recommended v0 listing posture:

- a listing keeps `price_usd` as the authored base price
- a listing may opt in to regional pricing with a lightweight flag or reference
- a listing must not snapshot a private country table in v0
- quote resolution must use the community's active pricing policy version at quote time

Recommended listing-side storage:

- replace freeform `regional_pricing_policy_json` with a narrow object such as:
  - `regional_pricing_mode = disabled | community_active`

If backward compatibility requires keeping `regional_pricing_policy_json`, constrain it to:

- `enabled`
- `policy_scope = community_active`

and do not allow embedded country mappings there.

## Quote Requirements

When regional pricing is enabled for a listing and community:

1. load the buyer's current verification capabilities
2. require `verification_capabilities.nationality.state = verified`
3. require `verification_capabilities.nationality.provider = self`
4. resolve the buyer nationality to a pricing tier
5. compute `final_price_usd`
6. snapshot `pricing_policy_version`
7. snapshot the verification input used for pricing

Required quote snapshot fields:

- `pricing_tier`
- `pricing_policy_version`
- `verification_snapshot_ref`

Minimum pricing verification snapshot content:

- nationality verification state used
- nationality country code used, if any
- provider used, which should be `self` in v0
- resolved `pricing_tier`
- applied `pricing_policy_version`

## Storage Shape

Recommended control-plane table:

- `community_pricing_policies`
  - `community_id` TEXT PRIMARY KEY
  - `regional_pricing_enabled` INTEGER NOT NULL
  - `verification_provider_requirement` TEXT
  - `default_tier_key` TEXT
  - `tiers_json` TEXT NOT NULL
  - `country_assignments_json` TEXT NOT NULL
  - `source_template_id` TEXT
  - `source_template_version` TEXT
  - `pricing_policy_version` TEXT NOT NULL
  - `updated_at` TEXT NOT NULL

Recommended invariants:

- `regional_pricing_enabled IN (0, 1)`
- `verification_provider_requirement IS NULL OR verification_provider_requirement IN ('self')`
- if `regional_pricing_enabled = 0`, `country_assignments_json` may be empty and quote pricing must fall back to base price

Recommended community-db listing change:

- keep `price_usd`
- replace or narrow `regional_pricing_policy_json` so it cannot encode a second hidden pricing policy

Recommended purchase-quote persistence:

- retain `pricing_tier`
- retain `pricing_policy_version`
- retain `verification_snapshot_ref`

Those fields already belong on the quote and purchase record because they are part of the commercial audit trail.

## API Shape

Recommended community API surface:

- `GET /communities/{community_id}/pricing-policy`
- `PATCH /communities/{community_id}/pricing-policy`

Resolved response properties should include:

- `policy_origin`
- `pricing_policy_version`
- `regional_pricing_enabled`
- `verification_provider_requirement`
- `default_tier_key`
- `tiers`
- `country_assignments`
- `source_template_id`
- `source_template_version`
- `updated_at`

PATCH request should replace the explicit community pricing policy.

Recommended v0 default response:

- `policy_origin = default`
- `regional_pricing_enabled = false`
- `pricing_policy_version = default`
- `tiers = []`
- `country_assignments = []`

## Community Rules vs Pricing Policy

Freeform community rules text is not the pricing policy.

This means:

- narrative rules may explain fairness or market posture
- only the structured pricing-policy object may affect purchase quote resolution
- money policy and pricing policy may evolve independently

## Open Questions

- Should `pricing_policy_version` be a UUID-like opaque version or a timestamped revision string?
- Should v0 allow `fixed_price_usd` tiers immediately, or start with `multiplier` only?
- Should listing opt-in be a boolean, or an enum that can later support more pricing modes?
