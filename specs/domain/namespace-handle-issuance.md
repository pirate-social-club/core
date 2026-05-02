# Namespace Handle Issuance

Status: current working spec

Related docs:

- [namespace.md](./namespace.md)
- [handles.md](./handles.md)
- [namespace-root-control.md](./namespace-root-control.md)
- [hns-authoritative-dns.md](./hns-authoritative-dns.md)
- [spaces-verification-flow.md](./spaces-verification-flow.md)
- [governance-backends.md](./governance-backends.md)
- [community-money-policy.md](./community-money-policy.md)

## Purpose

This doc defines the first public version of Pirate-managed namespace handle issuance.

It covers:

- how a TLD or Spaces root operator can sell, gift, reserve, auction, or gate names
- what buyers receive when they claim a name
- what Pirate administers as the platform
- how offchain claims, external resolution, and onchain registry projections stay separate
- how the system can later graduate toward multisig, DAO, or Majeur-backed communities

This doc uses `TLD operator` as product shorthand for the verified namespace authority. In the data model this may be the owner of an HNS root such as `pokemon/` or a Spaces root such as `@trainer`.

## Non-goals

This doc does not define:

- a v0 Solidity registry contract
- a v0 Solana program
- a bridge or cross-chain routing system
- the exact auction implementation
- full moderator, multisig, DAO, or Majeur permission wiring
- a synthetic namespace system for names that do not map to verified external roots

## Core Principle

Pirate should keep three concerns separate:

1. Claim right
   - the product right a buyer receives
   - v0 source of truth is an offchain Pirate lease record
2. External resolution
   - how `name.tld` or `name@space` resolves to a profile, community, asset, or other target
   - source is a resolver service with a stable interface
3. Registry projection
   - best-effort publication to DNS, Spaces, EVM, Solana, or another registry
   - source is an outbox and projection state, not the claim itself

The v0 system is offchain-authoritative. Onchain support is a later projection and graduation path, not the initial source of truth.

## V0 Product Posture

V0 supports verified external roots only.

That means:

- a HNS-style namespace such as `pokemon/` must be verified before Pirate can issue `name.pokemon`
- a Spaces-style namespace such as `@trainer` must be verified before Pirate can issue `name@trainer`
- a community that owns both roots may attach both roots as separate namespaces and issue independent handle inventories under each
- Pirate should not create internal-only `name@trainer` claims that look like real Spaces claims in v0

Cross-family internal domains are a later feature. They require careful collision and sovereignty rules and should not block the first useful namespace-handle system.

## Authority Model

The verified root owner is the initial policy authority.

V0 has one authority mode:

- `owner_controlled`

Recommended v0 fields on the namespace or namespace handle policy:

- `authority_mode`
  - v0 value: `owner_controlled`
- `policy_authority_user_id` nullable

Meaning:

- if `policy_authority_user_id` is null, policy authority falls back to the community creator or current verified root owner
- if root ownership is reverified to a different user, `policy_authority_user_id` may be set to that new controller
- policy authority should track root control, not only original community creation

All sensitive namespace-handle policy writes must pass through one authorization chokepoint:

```ts
assertCanManageNamespacePolicy(actor, namespace)
```

V0 behavior:

```ts
effectiveAuthority = namespace.policy_authority_user_id ?? community.creator_user_id
actor.user_id === effectiveAuthority
```

Future behavior may check delegated roles, multisig approval artifacts, or DAO proposal state. Callers should not change when the backing authority model evolves.

No endpoint, worker, CLI command, admin tool, or migration helper should bypass this authorization function for policy writes.

## Seller Eligibility And Accountability

Paid namespace handle issuance requires stronger operator accountability than ordinary community creation.

Before enabling paid claims, premium sales, auctions, or renewal charges, the TLD operator should complete a supported human verification step.

Recommended v0 seller requirement:

- verified root control for the namespace
- approved unique-human proof from `very`
- accepted namespace-seller terms
- payout destination configured
- explicit acknowledgement of operator risk and penalty terms

`self` remains a future supported provider when seller flows need richer compliance attributes such as age, jurisdiction, or document-derived capabilities. V0 seller eligibility only needs unique-human accountability.

Recommended seller accountability fields:

- `seller_verification_status`
  - `not_required`
  - `required`
  - `verified`
  - `restricted`
  - `revoked`
- `seller_verification_provider`
  - `self`
  - `very`
- `seller_identity_nullifier_hash`
- `seller_verified_at`
- `seller_terms_accepted_at`
- `seller_restricted_at` nullable
- `seller_revoked_at` nullable
- `seller_restriction_reason` nullable

Pirate should store only the provider-backed attestation and nullifier/hash needed for enforcement. Pirate should not store raw biometric data.

Important boundary:

- Pirate can revoke or nullify Pirate-side seller eligibility tied to a Self or Very verification.
- Pirate should not claim it can delete, mutate, or nullify the external Self or Very biometric credential itself.

If an operator sells namespace handles and then intentionally rugs buyers by withdrawing root authority, disabling required delegation, misrouting the namespace, or otherwise making paid handles unusable without a legitimate root-control dispute, Pirate may:

- pause new claims, renewals, sales, and auctions for that namespace
- mark the namespace as restricted or disputed
- revoke the operator's Pirate seller eligibility
- block the same verified-human nullifier from future namespace monetization
- preserve buyer leases where technically possible
- expose factual enforcement state in resolver and admin metadata
- require remediation before any future seller access

This is an anti-abuse control, not a guarantee that buyers can always retain native external resolution if the root owner removes DNS or protocol authority.

The seller enablement UI should make this explicit before commerce is enabled:

- the operator controls a powerful owner-managed namespace
- selling handles creates buyer reliance
- intentional rug behavior may permanently remove the operator's ability to monetize namespaces on Pirate
- enforcement is tied to their verified-human seller credential

## What TLD Operators Can Do

In v0, a TLD operator can:

- enable or disable public namespace handle claims for their verified namespace
- set a default handle policy
- choose whether labels are open, whitelist-only, or blacklist-style
- reserve labels such as `admin`, `mod`, `official`, `team`, or sensitive names
- create exact-label rules such as `charizard`
- create pattern rules such as `trainer-*`
- require eligibility gates for specific labels or patterns
- set fixed prices for labels or label classes
- set lease and renewal terms
- gift or admin-grant names when policy permits
- choose a supported payment profile
- choose the payout destination for proceeds
- request registry projection when Pirate supports it for that namespace
- change policy later, subject to audit and version checks

Examples:

- `charizard.pokemon` requires a Courtyard Pokemon Charizard NFT
- `gengar.pokemon` requires a Courtyard Pokemon Gengar NFT
- `trainer-2347.pokemon` is available to eligible members for a fixed price
- `admin.pokemon` is reserved and cannot be claimed

## What TLD Operators Cannot Do

In v0, a TLD operator cannot:

- issue names under a root they have not verified
- make Pirate treat an unverified internal domain as a real HNS or Spaces root
- bypass platform safety, abuse, or reserved-label rules
- bypass `assertCanManageNamespacePolicy`
- bypass seller verification before enabling paid namespace commerce
- silently rewrite claim history
- take over an active buyer handle without a policy-bound revocation reason
- sell arbitrary unsupported payment assets
- choose arbitrary ERC-20 tokens as settlement assets
- imply that a best-effort registry projection is complete when it is pending or failed
- enable onchain-authoritative claims before the governance and registry graduation path exists

The root owner has broad v0 power. This includes real rug risk. Pirate should expose that risk through derived metadata rather than pretending owner-controlled communities are already sovereign DAOs.

## What Buyers Can Do

In v0, a buyer can:

- search a namespace for label availability
- see why a label is available, reserved, gated, priced, or unavailable
- satisfy required eligibility gates
- pay the supported checkout asset for priced claims
- claim one active handle per namespace, unless policy later allows otherwise
- use the handle while its lease is active
- renew the handle if renewal policy allows it
- see the lifecycle state of their handle
- see whether external registry projection is synced, pending, retrying, failed, or not supported

The buyer receives an offchain lease right. The canonical identity of that right is:

```text
(namespace_id, normalized_label, club_handle_id)
```

The buyer does not need to understand registry projection details for ordinary use.

## What Buyers Cannot Do

In v0, a buyer cannot:

- claim labels that are reserved, blocked, already active, or in grace period
- bypass label eligibility gates
- bypass payment
- claim an arbitrary unsupported label in whitelist mode
- claim multiple active handles in the same namespace unless policy later allows it
- rely on an expired handle continuing to route forever
- assume that a DNS, Spaces, EVM, or Solana projection is authoritative unless the handle says so
- treat the lease as absolute property outside the policy terms

Handles are licensed namespace rights, not unconditional property.

## What Pirate Admins Can Do

Pirate as platform admin can:

- enforce platform-wide reserved labels and safety rules
- suspend or disable abusive namespaces
- suspend claims when root verification, DNS authority, or payment safety drifts
- operate the claim service, resolver service, checkout flow, and registry projection workers
- define supported payment profiles
- define platform fees
- review and fix failed registry operations
- provide admin grants when policy allows
- perform policy-bound revocations for fraud, invalid proof, ToS violations, issuance error, or other defined grounds
- expose audit logs and risk metadata

Pirate should enforce the policy chosen by the TLD operator, subject to platform limits.

## What Pirate Admins Cannot Do

Pirate admins should not:

- bypass `assertCanManageNamespacePolicy` for ordinary operator policy writes
- mutate namespace economics without authority, emergency basis, or explicit admin policy
- hide ownership or authority drift
- represent owner-controlled communities as DAO-governed
- mark registry projection as synced when the external write is not confirmed
- make broad bridge or chain-support claims before those rails exist
- collapse moderation authority and namespace economic authority into one accidental role

Emergency platform actions should be auditable and visibly distinct from normal TLD-operator policy changes.

## Handle Storage

Suggested v0 handle fields:

- `club_handle_id`
- `namespace_id`
- `user_id` nullable for reserved labels
- `normalized_label`
- `display_label`
- `status`
  - `active`
  - `grace_period`
  - `expired`
  - `revoked`
  - `reserved`
- `authority_source`
  - v0 value: `offchain`
  - future values: `dual_write`, `onchain`
- `issuance_mode`
  - v0 value: `offchain`
  - future value: `onchain`
- `issuance_chain` nullable
- `issuance_registry` nullable
- `issuance_token_id` nullable
- `issuance_tx_hash` nullable
- `issuance_confirmed_at` nullable
- `previous_handle_id` nullable
- `lease_started_at`
- `lease_expires_at`
- `grace_ends_at`
- `issuance_source`
  - `claim`
  - `sale`
  - `auction`
  - `admin_grant`
- `transferability`
  - v0 default: `disabled`
- `created_at`
- `updated_at`

Important:

- expired handles should remain expired
- reclaiming an expired label should create a new handle row
- the new row should point to the old row through `previous_handle_id`
- this preserves claim history and avoids reactivating old lifecycle rows

## Claim Concurrency

Claims should be first-commit-wins.

V0 should use:

- a database transaction
- an availability check inside the transaction
- a uniqueness constraint on active-ish labels

Recommended unique constraint:

```text
unique(namespace_id, normalized_label)
where status in ('active', 'grace_period', 'reserved')
```

Recommended user constraint:

```text
unique(namespace_id, user_id)
where status in ('active', 'grace_period')
```

If two users race for one label:

- the first committed transaction wins
- the losing transaction returns a deterministic `label_unavailable` error
- no claim queue is needed in v0

## Payment And Claim Finalization

Payment and handle finalization must account for claim races.

If payment succeeds but the claim transaction fails because availability changed concurrently, Pirate must refund the buyer or release the escrowed payment.

Recommended v0 posture:

- create a short-lived checkout or claim intent before collecting payment
- re-check availability immediately before finalizing payment
- finalize the handle claim in a transaction after payment confirmation
- if finalization fails, mark the payment for refund or automatic release
- expose the claim as incomplete until both payment and claim finalization succeed

Base USDC settlement does not make claim and payment atomic by itself. The checkout flow should use escrow, authorization, or another two-phase flow where possible.

## Namespace Handle Policy

Each namespace should have one default handle policy.

Suggested fields:

- `namespace_handle_policy_id`
- `namespace_id`
- `authority_mode`
- `policy_authority_user_id` nullable
- `claims_enabled`
- `handle_issuance_mode`
  - `pirate_managed`
  - later: `owner_managed`
- `available_label_mode`
  - `open`
  - `whitelist`
  - `blacklist`
- `default_eligibility_policy_json`
- `default_pricing_policy_json`
- `default_lease_policy_json`
- `default_transfer_policy_json`
- `default_resolution_policy_json`
- `payment_profile`
- `price_denomination`
- `seller_payout_wallet_id`
- `platform_fee_bps`
- `version`
- `created_at`
- `updated_at`

V0 should default to:

- `authority_mode = owner_controlled`
- `handle_issuance_mode = pirate_managed`
- `available_label_mode = open` unless the operator chooses whitelist mode
- `claims_enabled = false` until the namespace is intentionally opened
- one active handle per namespace per user
- offchain lease authority

## Policy Version Audit

Namespace-level policy changes must be audited the same way label-rule changes are audited.

This includes changes to:

- `claims_enabled`
- `handle_issuance_mode`
- `available_label_mode`
- default eligibility policy
- default pricing policy
- default lease policy
- payment profile
- payout destination
- platform fee

Suggested immutable version table:

- `namespace_handle_policy_version_id`
- `namespace_handle_policy_id`
- `namespace_id`
- `version`
- `snapshot_json`
- `changed_by_user_id`
- `change_source`
  - `owner`
  - `admin`
  - `system`
  - later: `multisig`
  - later: `majeur`
- `governance_ref` nullable
- `change_reason` nullable
- `created_at`

Policy writes should require optimistic concurrency:

- client submits expected `version`
- server rejects stale writes
- accepted write creates an immutable version snapshot

Changing `available_label_mode` from `open` to `whitelist` is economically meaningful and must leave an audit trail.

## Availability Modes

`available_label_mode` controls what happens when no label rule matches.

### Open

Unmatched labels fall through to the namespace default policy.

Good for broad communities where most reasonable names are claimable.

### Whitelist

Only labels matching an active rule are available.

Good for curated namespaces such as a Pokemon namespace where only explicit labels or generated patterns should be claimable.

### Blacklist

Unmatched labels fall through to the namespace default policy, but blocking or reserve rules remove labels.

Good for open communities that mainly need to protect sensitive labels.

## Label Rules

Label rules refine or override the namespace default policy.

Suggested fields:

- `namespace_handle_rule_id`
- `namespace_id`
- `label_match_type`
  - `exact`
  - `glob`
  - `regex`
  - `default`
- `label_match_value` nullable
- `generation_template_json` nullable
- `rule_kind`
  - `claim`
  - `sale`
  - `auction`
  - `reserve`
  - `admin_grant`
  - `system_generated`
- `eligibility_policy_json` nullable
- `pricing_policy_json` nullable
- `lease_policy_json` nullable
- `transfer_policy_json` nullable
- `resolution_policy_json` nullable
- `priority`
- `version`
- `status`
  - `active`
  - `disabled`
- `created_at`
- `updated_at`

Nullable policy fields inherit from the namespace default policy.

Important distinction:

- `label_match_type` answers whether a submitted label matches a rule
- `generation_template_json` answers how the system may produce suggested labels

Do not overload one field to mean both matching and generation.

## Rule Version Audit

Rule changes affect claim eligibility and pricing. They must be auditable.

Suggested immutable version table:

- `namespace_handle_rule_version_id`
- `namespace_handle_rule_id`
- `namespace_id`
- `version`
- `snapshot_json`
- `changed_by_user_id`
- `change_source`
  - `owner`
  - `admin`
  - `system`
  - later: `multisig`
  - later: `majeur`
- `governance_ref` nullable
- `change_reason` nullable
- `created_at`

Policy writes should require optimistic concurrency:

- client submits expected `version`
- server rejects stale writes
- accepted write creates an immutable version snapshot

## Gate Eligibility

Handle eligibility should use provider-neutral gate atoms.

Eligibility expressions should use the same AND/OR tree shape as community gates, with action-specific scopes.

Recommended scopes:

- `membership`
- `viewer`
- `posting`
- `handle_claim`
- `handle_renewal`
- `auction_bid`

The expression shape should be shared, but each scope should declare which atom types are valid. A gate atom that is valid for community membership may also be valid for handle claims. A gate atom that only makes sense for handles should not become valid for community joins by accident.

V0 expression operators:

- `and`
- `or`
- `threshold`
- `gate`

Suggested shape:

```ts
type GateExpression =
  | { op: "and"; children: GateExpression[] }
  | { op: "or"; children: GateExpression[] }
  | { op: "threshold"; count: number; children: GateExpression[] }
  | { op: "gate"; gate: GateAtom }
```

`threshold` means the user must satisfy at least `count` of the child expressions.

Example:

```json
{
  "op": "threshold",
  "count": 2,
  "children": [
    { "op": "gate", "gate": { "type": "metadata_match" } },
    { "op": "gate", "gate": { "type": "community_karma" } },
    { "op": "gate", "gate": { "type": "community_membership" } }
  ]
}
```

This represents "must satisfy at least 2 of these 3 requirements."

Do not add `not` or exclusion operators in v0. Negative requirements such as "must not hold this token" are harder to evaluate, harder to explain, and easier to misuse. Exclusion logic should be a v1+ design if real communities need it.

Recommended atom families:

- `contract_any`
- `token_id_allowlist`
- `metadata_match`
- `token_balance`
- `community_membership`
- `community_karma`
- `account_age`
- identity gates already used by community membership where applicable

Provider-specific systems such as Courtyard should sit behind adapters.

Example:

- public rule says `metadata_match` for Pokemon Charizard card ownership
- Courtyard adapter discovers and verifies matching NFTs
- the durable policy does not encode Courtyard as the gate type

This keeps the model extensible to:

- Ethereum mainnet
- Base
- other EVM chains
- Solana
- future inventory providers

V0 implementation should not block on every future atom. The first public handle-claim implementation can support membership and token or metadata gates, while the UI and expression contract leave room for community karma and other derived signals later.

Suggested evaluation seam:

```ts
evaluateEligibilityExpression(scope, expression, context)
```

This should return a trace of all evaluated atoms, not only blockers.

Example availability response:

```json
{
  "label": "charizard",
  "state": "available_gated",
  "eligible": false,
  "atoms": [
    {
      "type": "metadata_match",
      "label": "Charizard Pokemon card",
      "passed": true
    },
    {
      "type": "community_karma",
      "label": "50 community karma",
      "current_value": 23,
      "required_value": 50,
      "passed": false
    }
  ],
  "price": {
    "amount_cents": 2500,
    "payment_profile": "base_usdc"
  }
}
```

The UI should render passed atoms as satisfied requirements and failed atoms as remaining requirements. Keeping all atoms in expression order helps users understand what they already satisfy and what still blocks the claim.

## Payment Currency

V0 should start simple.

Recommended v0 payment profile:

- `payment_profile = base_usdc`
- `payment_chain = eip155:8453`
- `settlement_asset = USDC`
- `price_denomination = usd`

Meaning:

- buyers see dollar prices
- checkout collects USDC on Base
- sellers receive USDC on Base
- Pirate does not need a bridge for v0

TLD operators can choose prices. They cannot choose arbitrary payment rails in v0.

Recommended v0 revenue split:

- Pirate receives `platform_fee_bps` basis points
- remaining proceeds go to `seller_payout_wallet_id`
- future splits may include community treasury, artist share, creator share, or other configured destinations

Revenue split changes are namespace-level policy changes and must be versioned.

Separate these concepts:

- gate chain
  - where eligibility assets live
  - example: Courtyard NFT on Ethereum, Base, or Polygon
- payment chain
  - where buyer payment happens
  - v0: Base
- registry chain
  - where onchain projection may later live
  - future: EVM or Solana registry

These fields must not be coupled.

Future payment profiles may include:

- `base_usdc`
- `base_eth`
- `ethereum_usdc`
- `ethereum_eth`
- `solana_usdc`

Do not let sellers choose arbitrary ERC-20s early. That creates volatility, scam-token risk, support load, refund complexity, and indexer complexity.

## Resolver Service

The resolver service is the stable abstraction used by gateways, browsers, APIs, and future registry observers.

Suggested response:

```ts
type HandleResolution = {
  lifecycle_state:
    | "active"
    | "grace_period"
    | "expired"
    | "revoked"
    | "reserved"
    | "unregistered"
  authority_source: "offchain" | "dual_write" | "onchain" | null
  target_type:
    | "profile"
    | "community"
    | "community_template"
    | "asset"
    | "custom_url"
    | "none"
  target_ref: string | null
  projection_status: "synced" | "pending" | "retrying" | "failed" | "stale" | "unsupported"
  namespace_authority_mode: "owner_controlled" | "multisig" | "majeur"
  policy_change_count: number
  last_policy_change_at: number | null
}
```

V0 implementation may read only Pirate's offchain handle tables.

Later backends may include:

- HNS DNS state
- Spaces resolver state
- EVM registry state
- Solana program state

The gateway should call the resolver service. It should not know which backend is authoritative for a given handle.

## Resolution Lifecycle

Claim eligibility and runtime resolution use different precedence.

### Claim Eligibility

Recommended order:

1. active or grace-period handle blocks claim
2. reserved handle or reserve rule blocks claim
3. expired handle may be reclaimable if release policy allows
4. exact label rule
5. pattern rule
6. namespace default policy if `available_label_mode = open` or `blacklist`
7. unavailable if `available_label_mode = whitelist` and no rule matched

### Runtime Resolution

Recommended order:

1. active handle routes to its configured target
2. grace-period handle routes according to lease or resolution policy
3. expired handle does not route to the old owner
4. revoked handle does not route to the old owner
5. reserved label routes to community, unavailable page, or another configured target
6. no handle returns unregistered

Grace period behavior must be explicit. The gateway should not accidentally break links or route stale ownership because expiry behavior was left implicit.

V0 default:

- grace-period handles continue routing to the current holder's profile
- resolver responses include `lifecycle_state = "grace_period"`
- consumers may display expiry or renewal warnings
- once grace ends, the handle must not route to the old owner

## Resolution Targets

V0 may only expose profile routing publicly, but the resolver should be typed from the beginning.

Supported target types:

- `profile`
- `community`
- `community_template`
- `asset`
- `custom_url`
- `none`

Examples:

- `trainer-2347.pokemon` routes to the buyer's profile
- `charizard.pokemon` may initially route to the buyer's profile
- later, `charizard.pokemon` may route to a card showcase or community template page
- `admin.pokemon` may route to the community page or unavailable page

## HNS Resolution

For HNS roots, external resolution requires DNS authority.

Typical flow:

1. HNS root owner verifies root control.
2. Root owner delegates DNS or points records at Pirate.
3. Pirate serves explicit or wildcard records for the zone.
4. HNS-aware browser resolves `charizard.pokemon`.
5. HTTP gateway reads the Host header.
6. Gateway asks the resolver service for `charizard` under namespace `pokemon`.
7. Gateway serves the returned target.

Important:

- DNS authority is a technical capability
- public handle commerce is a product permission
- one does not imply the other

## Spaces Resolution

For Spaces roots, v0 should require verified Spaces root attachment before issuing Spaces-style handles.

Typical flow:

1. Spaces root owner verifies `@trainer`.
2. Pirate stores `@trainer` as a namespace.
3. Buyer claims `name@trainer`.
4. Browser or API calls Pirate's resolver for `name@trainer`.
5. Resolver returns the typed target.

If Spaces-native subspace issuance becomes available, it can be added as a registry projection backend.

Until then, Pirate must clearly distinguish:

- verified Spaces root
- Pirate-managed offchain handle under that root
- Spaces-native subspace projection, if any

## Registry Projection Outbox

Registry projection is best-effort in v0.

Projection failure does not invalidate the handle lease.

Suggested projection records:

- `registry_projection_id`
- `club_handle_id`
- `namespace_id`
- `normalized_label`
- `target_registry`
- `desired_state_json`
- `observed_state_json` nullable
- `status`
  - `pending`
  - `synced`
  - `retrying`
  - `failed`
  - `stale`
  - `disabled`
- `last_operation_id` nullable
- `created_at`
- `updated_at`

Suggested operation records:

- `registry_operation_id`
- `idempotency_key`
- `club_handle_id`
- `namespace_id`
- `target_registry`
- `operation_type`
  - `publish_dns`
  - `publish_spaces`
  - `migrate_to_onchain`
  - `renew_onchain`
  - `revoke_projection`
- `desired_version`
- `status`
  - `queued`
  - `submitting`
  - `submitted`
  - `confirmed`
  - `failed`
  - `abandoned`
- `submitted_tx_hash` nullable
- `external_ref` nullable
- `error_code` nullable
- `created_at`
- `updated_at`

Idempotency key should be derived from:

```text
namespace_id + normalized_label + operation_type + target_registry + desired_version
```

If DNS publish succeeds but confirmation is lost, reprocessing must not create duplicate state.

If an EVM transaction is submitted but confirmation is uncertain, the observer must check the original transaction before submitting another.

## Onchain Graduation

Onchain support is a later graduation path.

Each namespace may pass through three phases:

### Phase 1: Offchain Authoritative

Pirate handle tables are the source of truth.

Registry projections may exist, but they are best-effort.

V0 lives here.

### Phase 2: Dual Write

New claims and renewals write both offchain and onchain.

Existing claims remain offchain-only until renewed or explicitly migrated.

The resolver still primarily trusts offchain state unless a handle has migrated.

### Phase 3: Onchain Authoritative For Migrated Claims

For migrated handles, onchain state becomes authoritative.

Pirate's offchain store becomes a cache and index.

Unmigrated handles in the same namespace may remain offchain-authoritative.

Authority is per handle:

- `authority_source = offchain`
- `authority_source = dual_write`
- `authority_source = onchain`

Mixed state is acceptable if each handle clearly states its authority source.

## Graduation Requirements

Onchain graduation should require all of:

- governance hardening
- meaningful community activity
- explicit opt-in

Governance hardening is the hard gate.

Directional requirements:

- centralized single-owner communities cannot enable onchain-authoritative handle rights
- multisig or DAO-style governance must be configured first
- the governance backend should have completed at least one successful governance action before graduation
- claim count or treasury volume may be used as activity signals
- graduation must be explicitly enabled by the namespace authority

Claim count alone is not sufficient.

## Future Registry Models

For EVM, two likely models exist:

1. handle-as-lease NFT
2. registry mapping without tokens

Directional preference:

- use handle-as-lease NFT when composability matters
- keep expiry, renewal, transfer policy, and resolution validity in registry logic
- do not present the NFT as absolute property if the product right is a licensed lease

For Solana:

- use a program that manages handle entries with configurable namespace authority
- integrate through the same registry projection outbox

The offchain handle identity remains stable regardless of projection backend.

## Root Disputes After Purchase

Namespace root control may become disputed after paid handles exist.

Recommended v0 behavior:

- existing active leases remain valid for their remaining term
- new claims, renewals, premium sales, and auctions pause while the root is disputed
- resolver responses may continue routing active handles but must include disputed root status in risk metadata
- if the dispute resolves to a different root owner, the new verified root owner becomes the policy authority
- the new owner inherits the existing lease book and may not revoke active claims solely because root ownership changed
- policy-bound revocation remains available for fraud, invalid proof, ToS violations, or issuance error

This protects buyers from immediate loss during ownership disputes while preserving the root owner's long-term namespace authority.

## Risk Metadata

Resolvers and public namespace reads should expose derived risk and authority metadata.

Suggested public fields:

- `namespace_authority_mode`
- `seller_verification_status`
- `seller_enforcement_status`
- `policy_change_count`
- `last_policy_change_at`
- `root_verification_status`
- `delegation_status`
- `projection_status`

Avoid exposing private user IDs in public resolver responses.

The metadata should be factual, not editorial. For example:

- `owner_controlled`
- `multisig`
- `majeur`

Consumers can decide how much trust to place in an owner-controlled namespace.

## V0 Build Order

Recommended implementation order:

1. Namespace and handle storage from existing specs
2. Provider-neutral gate atom normalization
3. Default-policy offchain claim flow with leases and uniqueness constraints
4. Resolver service abstraction with typed resolution targets
5. Label-pattern rules and rule version audit
6. HNS DNS and gateway projection
7. Spaces-style API resolution
8. Fixed-price sales
9. Auctions
10. Onchain registry projections

Each step should be buildable and testable in isolation.

The two important implementation seams are:

- `assertCanManageNamespacePolicy`
- `HandleResolver`

Keep those stable and strict from the first implementation.

## Storybook And UI Reuse

The hardest new UI surface is the label rule editor because one rule combines:

- label selector
- eligibility expression
- pricing policy
- lease policy
- resolution target

Recommended UI sequence:

1. reusable AND/OR gate-expression editor
2. label rule editor using the shared gate-expression editor
3. availability and eligibility result states
4. claim flow with checkout states
5. seller onboarding with Very verification, terms, payout, and claims enablement
6. resolver metadata display

The shared gate-expression editor should be scope-aware. It should accept a scope such as `membership` or `handle_claim` and only expose atom builders valid for that scope.

This prevents the handle sales UI from forking a second gate builder while also preventing membership-only assumptions from leaking into handle claims.

Storybook can mock `evaluateEligibilityExpression` traces before backend support is complete. This lets the UI contract stabilize before every atom family exists in production.

The expression editor should support two modes:

- simple mode
  - one flat group
  - group mode selector: `all`, `any`, or `x_of_y`
  - no nesting
- advanced mode
  - nested groups
  - maximum depth of 2 levels for v0

UI mapping:

- group card with `all` maps to `op = and`
- group card with `any` maps to `op = or`
- group card with `x_of_y` maps to `op = threshold`
- requirement card maps to `op = gate`
- nested group maps to another group node in `children`

If a handle eligibility policy needs deeper nesting than 2 levels, the product should ask the operator to simplify the policy rather than exposing an unbounded rule builder.

## Emergency Platform Actions

Emergency platform actions are distinct from ordinary namespace policy management.

Examples:

- fraud detection and response
- legal compliance
- platform safety incidents
- payment settlement failures
- contradictory root verification evidence
- registry projection incidents that could misroute users

Emergency actions must:

- be logged with `change_source = admin` or `change_source = system`
- include a `change_reason`
- be visibly distinct from TLD-operator policy changes
- avoid broader mutation than the emergency requires

Emergency authority does not remove the rule that ordinary namespace policy writes must go through `assertCanManageNamespacePolicy`.

## System-Generated Labels

`rule_kind = system_generated` is a future-facing rule kind.

Expected flow:

1. system reads `generation_template_json`
2. system generates candidate labels
3. user selects or accepts a generated label
4. normal claim availability, gate, payment, and lease finalization logic runs

Generated labels should not bypass eligibility, pricing, or concurrency rules.

## Open Questions

- What exact platform-wide reserved label set applies to every namespace?
- What is the default platform fee for handle sales and renewals?
- What is the minimum lease duration for public v0?
- What is the v0 checkout escrow or refund strategy when payment succeeds but claim finalization fails due to a concurrent availability change?
- Which governance state should first unlock onchain graduation: multisig only, Majeur only, or either?
- Should owner-controlled namespaces display explicit buyer warnings during checkout?
