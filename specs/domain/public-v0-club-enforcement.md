# Public V0 Community Enforcement

Implementation checklist for enforcing the locked public v0 community-creation and handle-claim contract.

This doc is not a new product spec. It translates the existing public v0 decisions in [community.md](./community.md), [handles.md](./handles.md), [namespace.md](./namespace.md), and [namespace-root-control.md](./namespace-root-control.md) into server-side enforcement requirements.

## Purpose

Public v0 now has a clear product contract:

- HNS is the only live external namespace family
- Spaces is coming soon and must not enter the live public create flow
- public community creation is centralized-only
- public club membership modes are `open` or `gated`
- new public communities start with a `standard` handle policy while public namespace claims and sales remain disabled
- early communities are groups of Pirates first
- namespace attachment does not imply live namespace commerce

The backend must enforce those rules directly. The public client should not be trusted to keep the contract intact on its own.

## Enforcement Surfaces

The minimum write-model enforcement surfaces are:

- namespace verification flow producing `namespace_verification_id`
- `POST /communities`
- namespace settings updates that can affect routing or delegation
- handle availability endpoints
- handle claim, renew, revoke, and pricing endpoints
- club read-model derivation for `community_stage` and related capability flags

## Namespace Verification

The namespace-verification service is the first hard dependency.

It must produce a server-trusted `namespace_verification_id` that binds:

- namespace family
- normalized root label
- proof owner or controller identity
- verification evidence status
- expiry or freshness state
- capability classification
- issuance timestamp

For HNS public v0, the accepted verification object must support all of:

- root existence check
- normalized root identity
- root-control proof
- expiry-horizon sufficiency
- delegation classification
- stale, disputed, or expired invalidation

Public v0 create must reject raw client-entered namespace labels as proof of authority. `namespace_verification_id` is the proof-bearing reference.

## `POST /communities`

Public v0 create must reject any request that violates these conditions.

### Accepted Input Contract

- namespace family is HNS only
- `governance_mode = centralized`
- `membership_mode in {open, gated}`
- namespace attachment includes a valid `namespace_verification_id`
- the public client must submit `handle_policy.policy_template = standard`
- the server should default omitted handle policy to `standard` only for trusted internal callers
- gate rules, if present, are limited to membership-scope identity-proof presets

### Required Verification Checks

- creator must have accepted `unique_human` verification
- if `default_age_gate_policy = 18_plus`, creator must also have accepted `age_over_18` verification
- `namespace_verification_id` must belong to the creating user
- namespace verification must still be active, undisputed, and fresh at create time
- the server must resolve `namespace_verification_id` to the accepted namespace-verification object and evaluate that object authoritatively at create time rather than trusting the field's presence alone

### Public V0 Rejections

Reject public create if any of the following appear:

- `governance_mode != centralized`
- `membership_mode = request`
- namespace family is Spaces or any unsupported family
- `handle_policy.policy_template != standard`
- token-gate rules
- `viewer`-scope or `posting`-scope gates
- create-time multisig attachment data
- create-time majeur data
- donation-policy configuration from the public create surface
- community-bootstrap configuration from the public create surface
- `post_ephemeral` anonymous scope in the ordinary public v0 create flow

Exceptional internal flows that can prove the full safeguard set from [community.md](./community.md) are out of scope for this public-v0 enforcement note.

### Create-Time Derivations

On successful create, the server must derive and persist:

- initial `community_stage`
- `member_count`
- `qualified_member_count`
- `stage_entered_at`
- derived capability flags with all namespace-commerce capabilities disabled for the initial stage

The server must not infer that namespace commerce is live merely because the namespace was verified or attached.

## Community Stage

`community_stage` is a derived read-model field, not a user-controlled setting.

The stage system needs only one guaranteed public-v0 invariant:

- every new public community starts in the initial stage

The server may define additional internal or later-public stages, but the enforcement model must already derive capability flags from stage rather than assuming claims are live.

The core derived capability flags are:

- `community_local_handle_claims_enabled`
- `premium_handle_sales_enabled`
- `auction_enabled`

These flags must be recomputed server-side from current community state, not submitted by clients.

## Technical Capability vs Product Permission

`pirate_subdomain_issuance_allowed` remains a technical namespace capability.

It answers whether Pirate can technically manage subdomain resolution for a namespace. It does not answer whether the product should allow claim or sale flows.

Public handle commerce must require both:

- technical namespace capability where relevant
- product permission from `community_stage` and related enforcement rules

For priced or scarce namespace inventory, governance hardening may also be required even after technical capability exists.

## Handle Availability

Handle availability endpoints must enforce more than label availability.

For a namespace where `community_local_handle_claims_enabled = false`, the server should return:

- `eligible = false`
- a human-readable `reason` explaining that community-local claims are not yet enabled

The same applies when claims are blocked by:

- stage lock
- lack of namespace delegation
- verification drift
- unsupported premium inventory
- governance posture requirements

The server must not answer “available” in a way that implies the user can actually complete a claim when claims are not enabled.

## Handle Claim And Renewal

Handle-claim endpoints must enforce all of:

- community-local claims are enabled for the club
- namespace capability permits the relevant claim path
- creator or claimant passes any identity-proof or trust requirements
- requested inventory is permitted under current pricing and auction rules

Public v0 communities with `community_local_handle_claims_enabled = false` must not allow:

- public claim of `name.namespace`
- premium-priced namespace inventory
- scarce-label auctions

If renewals exist for namespace-local handles before public claims open, they must only apply to already-issued internal state and must not imply that new claims are open.

## Namespace Capability Drift

Namespace state can degrade after community creation. Enforcement must distinguish between:

- blocking new community creation
- blocking new namespace-handle claims
- preserving existing club routes

Minimum expected behavior:

- stale, disputed, or expired verification blocks new community creation
- loss of delegated namespace authority blocks new Pirate-managed namespace claims
- near-expiry roots should block new paid namespace sales before they block an existing club route

Do not collapse all namespace failures into one generic disabled state if they have different product consequences.

## Audit And Telemetry

Server enforcement should record why actions were accepted or rejected.

Recommended audit fields:

- create rejection reason
- namespace verification source and evaluated status
- creator verification state at decision time
- computed `community_stage`
- computed capability flags
- claim rejection reason

This matters because public v0 intentionally separates:

- club existence
- namespace attachment
- technical namespace capability
- namespace commerce permission

Without auditability, those distinctions will collapse again in implementation.

## Minimum Backend Sequence

Recommended implementation order:

1. implement namespace verification and `namespace_verification_id`
2. enforce public-v0 create rules in `POST /communities`
3. derive `community_stage` and capability flags on the club read model
4. gate handle availability and claim flows on stage plus namespace capability
5. add telemetry for every blocked path above

## Non-Goals

This doc does not define:

- the exact threshold table behind `community_stage`
- the final user-facing labels for stage names
- the future post-launch namespace economy model
- the eventual Spaces integration contract

Those may evolve without changing the public-v0 enforcement boundary described here.
