# Handles

Status: draft

Related docs:

- [community.md](./community.md)
- [namespace.md](./namespace.md)
- [artist-identity.md](./artist-identity.md)
- [user.md](./user.md)
- [profile.md](./profile.md)
- [onboarding.md](./onboarding.md)
- [karma.md](./karma.md)

## Purpose

This doc defines community-local user handles such as:

- `name.kanye`
- `name@kanye`

It also defines how community-local handles relate to Pirate's global `.pirate` identity layer.

It covers:

- what a handle is
- how handles relate to communities and namespaces
- issuance mode
- length tiers and eligibility
- lease and renewal semantics
- auction as a product concept
- how native and imported trust affect handle eligibility

## Non-goals

This doc does not define:

- Solidity contract interfaces
- exact auction implementation
- exact resolver adapter mechanics for HNS or Spaces
- full karma/reputation scoring formulas
- the full global `.pirate` pricing table

## Core Principle

A handle is a community-scoped namespace right.

Examples:

- `name.kanye`
- `name@kanye`

Handles are:

- scarce
- transferable only if community policy allows it
- leasable rather than perpetual in v0
- offchain by default in v0
- governed by community policy and platform ToS

Handles are not absolute property.

Pirate also has a separate global identity layer:

- `name.pirate`

The global `.pirate` layer is app-level and should follow stricter anti-hoarding rules than old Pirate.

In v0, a handle is best understood as a revocable licensed right to use a label within a club namespace, subject to:

- club governance policy
- renewal rules
- platform ToS and moderation rules

The same general principle should apply to upgraded `.pirate` names:

- they are licensed product rights, not absolute property

## Issuance Mode

V0 default:

- handles are issued offchain by default

Reasoning:

- less contract work
- less attack surface
- fewer irreversible mistakes before handle policy is proven in production
- communities can learn policy implications before minting durable onchain rights

Onchain issuance is a later upgrade step, not the default launch behavior.

Suggested issuance fields:

- `issuance_mode`
  - `offchain`
  - `onchain`
- `issuance_chain` nullable
- `issuance_contract` nullable
- `issuance_token_id` nullable

Rules:

- canonical handle identity is `(namespace_id, label)`, not `(chain, contract, token_id)`
- onchain issuance is preferred later when governance is strong enough to support it safely
- offchain issuance remains valid even if no onchain token exists
- in v0, `issuance_mode` is always `offchain`
- in v0, `issuance_chain`, `issuance_contract`, and `issuance_token_id` are always `null`
- community creation already assumes verified control of the corresponding HNS or Spaces root
- Pirate-managed externally resolvable handles require namespace delegation to Pirate

## Governance Threshold For Onchain Issuance

Onchain handle issuance should not be enabled by default for creator-controlled communities at launch.

Directional v0 recommendation:

- offchain handles are available from the start
- onchain handle issuance may only be enabled after governance hardening

Examples of governance hardening:

- club controlled by multisig
- club governed by DAO
- explicit policy activation by a stronger governance backend

This reduces the risk that a single root owner prematurely mints durable onchain handle rights without the club understanding the policy implications.

## Relationship To Community And Namespace

A handle belongs to exactly one namespace, and a namespace belongs to exactly one club.

So the chain is:

- `club`
- `namespace`
- `handle`

Examples:

- bare-label namespace `/c/kanye` can issue `name.kanye`
- `@` namespace `/c/@kanye` can issue `name@kanye`

Handles are unique per namespace.

In v0:

- `name.kanye` and `name@kanye` are distinct handle rights
- `name.kanye` and `name.肯伊` are distinct handle rights even if both namespaces point to the same club
- claims are not mirrored across route families
- claims are not mirrored across namespace mirrors more generally
- if cross-family mirroring ever exists, it must be an explicit future feature
- the root owner is the effective authority at launch until governance is upgraded
- one user may hold different handles in different namespaces, including multiple sibling namespaces attached to the same club

## Relationship To Global `.pirate`

Pirate's global `.pirate` identity is not a club namespace.

It should be treated as:

- a platform-level identity layer
- one active global handle per user in v0
- separate from community-local handle inventories

Recommended v0 behavior:

- every user receives one generated `.pirate` handle at signup
- one free cleanup rename is allowed during onboarding or early account setup
- later upgrades into cleaner or scarcer `.pirate` handles may be paid
- upgraded `.pirate` handles replace the user's active global handle rather than creating multiple active global identities
- global `.pirate` handles are platform-level identity records, not club-handle leases

Directional v0 `.pirate` policy:

- `8+` characters: generated or standard
- one free cleanup rename allowed within the first `7 days`
- later `8+` character changes may be flat-fee paid upgrades
- `7` characters: paid premium inventory
- `6` characters: paid and manually reviewed premium inventory
- `1-5` characters: reserved, auction-only, or admin-assigned

Actor rule:

- `.pirate` upgrades are performed by the authenticated user for their own active global handle, unless an explicit admin-grant path applies

## V0 Handle Shape

Suggested v0 fields:

- `club_handle_id`
- `namespace_id`
- `user_id`
- `label`
- `status`
- `lease_started_at`
- `lease_expires_at`
- `grace_ends_at`
- `issuance_mode`
- `issuance_chain` nullable
- `issuance_contract` nullable
- `issuance_token_id` nullable
- `issuance_source`
- `transferability`
- `created_at`
- `updated_at`

Suggested meanings:

- `label`
  The user-controlled label part, e.g. `name`
- `status`
  - `active`
  - `grace_period`
  - `expired`
  - `revoked`
  - `reserved`
- `issuance_mode`
  - `offchain`
  - `onchain`
- `issuance_source`
  - `claim`
  - `auction`
  - `admin_grant`
- `transferability`
  - `enabled`
  - `disabled`

Uniqueness:

- unique on `(namespace_id, label)`

Derived values:

- `community_id` is derived through the namespace join
- `display_handle` is derived at read time from `label` plus the namespace label and route family
- UI may also derive sibling-namespace handle badges for the same `user_id`, but those do not affect namespace-local ownership or claim rights

Operational note:

- a handle may exist in Pirate before Pirate itself is managing external resolver issuance
- whether Pirate can automatically make that handle externally resolvable depends on namespace delegation state
- mirrored club namespaces may expose different available-handle inventories even though they point to the same club

## Label Rules

V0 handle label rules:

- ASCII lowercase only
- allowed characters: `a-z`, `0-9`, `-`
- length limits are controlled by club handle policy
- may not begin or end with `-`
- must not collide with reserved labels in that namespace

Unicode and broader normalization are out of scope for v0.

## Claim And Upgrade Abuse Controls

Handle claiming should not rely only on availability checks.

Recommended v0 controls:

- require bot protection such as Turnstile or CAPTCHA on handle claims and `.pirate` upgrades
- rate-limit repeated availability probes and repeated rename attempts
- keep one active handle per namespace per user in v0
- keep one active global `.pirate` handle per user in v0
- reserve premium short-handle inventory rather than leaving it open to fast claim races

Important rule:

- CAPTCHA helps with automation abuse
- anti-hoarding still requires pricing, limits, reserved inventory, and moderation policy

## Handle Policy

Each club namespace may define handle policy.

Suggested v0 policy fields:

- `namespace_id`
- `policy_template`
- `open_min_length`
- `trusted_min_length`
- `premium_min_length`
- `pricing_model`
- `length_price_schedule_json`
- `reserved_label_pricing_json` nullable
- `generated_label_policy` nullable
- `membership_required_for_claim`
- `gate_required_for_claim`
- `lease_duration_days`
- `grace_duration_days`
- `renewal_price_policy` nullable
- `auction_policy` nullable
- `reserved_labels`
- `trust_discount_policy` nullable
- `transfer_policy`
- `created_at`
- `updated_at`

Example interpretation:

- `8+` characters: broadly claimable
- `6-7` characters: trust-gated
- `4-5` characters: premium / auction / club-assigned
- `1-3` characters: reserved or premium-only

The exact numbers are policy, not protocol.

Suggested meanings:

- `policy_template`
  - `standard`
  - `premium`
  - `membership_gated`
  - `custom`
- `pricing_model`
  - `free`
  - `flat_by_length`
  - `custom_curve`
  - `gated_then_flat`
- `generated_label_policy`
  A policy object for system-suggested available names, including optional ontology/vocabulary sets and numeric suffix format.
- `membership_required_for_claim`
  If true, the user must first be a member of the club before claiming a namespace handle.
- `gate_required_for_claim`
  If true, the user must satisfy the club's viewer/posting/token gate policy before claiming a namespace handle.
- `trust_discount_policy`
  Optional future discount policy based on trusted native signals. Disabled by default in v0. See [karma.md](./karma.md) for the canonical karma model.

V0 defaults:

These defaults apply only once a namespace has enabled public community-local handle claims.
New public communities may carry a `standard` policy record while `club_local_handle_claims_enabled = false`.

- `8+` characters
  Claimable by any verified eligible member
- `7` characters
  Claimable only when the user passes the namespace's trust-gated eligibility checks
- `6` characters
  Claimable only via manual approval, notable-status approval, or explicit governance grant
- `1-5` characters
  Not automatically claimable in v0; reserved, auction-only, or governance-assigned

- `renewal_price_policy = null`
  Renewal is free in v0 unless a later policy explicitly enables priced renewal.
- `auction_policy = null`
  Auctions are disabled by default in v0.
- `trust_discount_policy = null`
  Native-karma or trust-based pricing discounts are disabled by default in v0 until community karma tiers are well-established. See [karma.md](./karma.md).

## Claims-Disabled Launch Posture

New public communities should default to a `standard` namespace handle policy while public claims remain disabled at launch.

Launch semantics:

- the namespace route exists for the club
- the namespace may still have verified root attachment and routing
- public community-local handle claims are disabled
- public premium handle sales are disabled
- auctions are disabled
- members identify publicly through their global `.pirate` handles by default
- pricing configuration exists but is not yet actionable because no public claims or sales are enabled

Important:

- a claims-disabled launch posture does not mean the namespace is missing a handle policy; it means the handle policy exists before commerce is enabled
- a new club may start with `policy_template = standard` while `club_local_handle_claims_enabled = false`
- the namespace may later upgrade to `premium`, `membership_gated`, or `custom` once the club reaches the required derived community stage and other prerequisites
- Pirate-managed external resolution capability alone does not imply public claims are live

## Handle Policy Templates

Community creation should not leave namespace-handle economics undefined.
These templates describe behavior once claims are enabled; they are not a substitute for launch-state capability flags.

Recommended v0 templates:

- `standard`
  - default template for new public communities
  - `8+` broadly available
  - shorter names increasingly restricted
  - first normal commerce-enabled template for most artist and fan communities once claims are enabled
- `premium`
  - short and high-signal names explicitly monetized
  - reserved names like `king`, `vip`, or `official` may be individually priced or auctioned
- `membership_gated`
  - community gate or NFT/token gate comes first
  - names may then be free or cheap once the user is eligible
- `custom`
  - creator picks explicit values for the policy fields above
  - should still respect platform minimum safety and reserved-label rules

Important rule:

- every namespace should have a handle policy record at community creation time, even if it is just one of the default templates

## Generated Name Ontologies

Communities may want system-generated name suggestions rather than only raw freeform search.

Recommended v0 support:

- `generated_label_policy` may define:
  - one or more allowlisted word sets
  - an output pattern such as `word-word-4digits`
  - profanity and reserved-word filtering
  - minimum total generated length

Examples:

- `.pirate` global handles may use `adjective-noun-4digits`
- a club could later use a custom ontology such as themed word sets for its namespace

Directional v0 recommendation:

- generated club-handle suggestions should usually land at `8+` characters so the system is not accidentally allocating scarce premium inventory by default

## Eligibility

Eligibility should be derived, not stored as a permanent score.

Inputs may include:

- native Pirate reputation within that club
- native global Pirate reputation
- account age on Pirate
- imported onboarding trust, such as subreddit-specific Reddit karma
- moderator or governance grants

Important rule:

- imported trust is a bootstrap signal
- native Pirate activity should matter more over time

The system may compute:

- minimum claimable length
- bid eligibility for premium handles
- whether a user can bypass club approval for certain lengths

But it should compute those from underlying signals and snapshots, not maintain a long-lived opaque trust score as canonical state.

## Relationship To Karma And Imported Trust

Pirate karma and imported reputation are not the same thing.

- `Pirate karma` = earned on Pirate, defined in [karma.md](./karma.md)
- `imported trust` = onboarding-time external proof/snapshot

For handles:

- Pirate-native club reputation should be the primary signal
- imported subreddit-specific Reddit karma may provide an initial bootstrap
- global Reddit karma should have limited effect

Example:

- strong imported `/r/kanye` karma can improve initial eligibility for `*.kanye`
- it should not dominate long-term handle allocation

Pricing note:

- club creators may eventually want native-karma discounts for handle pricing
- Pirate should not depend on that in v0 because a canonical native karma/reputation spec does not yet exist

## One Handle Per Namespace

V0 should keep active identity simple.

Recommended rule:

- one `user_id` may hold many handles across many namespaces
- one `user_id` may hold at most one active handle per namespace in v0
- one `user_id` may hold at most one active global `.pirate` handle in v0
- later secondary ownership or inventory models may exist, but only one active namespace-local identity should render by default

## Lease Semantics

V0 handles are leases, not perpetual grants.

Each handle has:

- a lease start time
- an expiry time
- a grace period end time

When a lease expires:

- the handle enters grace period
- the handle status becomes `grace_period`
- the current holder retains renewal priority until grace ends
- transfer is disabled during grace period
- the handle is not usable as an active in-product handle during grace period

After grace ends:

- the handle status becomes `expired`
- the handle may be reclaimed, reissued, or auctioned under community policy

## Renewal Semantics

Renewal behavior is a product-level rule, not contract-specific.

V0 recommendations:

- renewal price is set by community policy
- community policy may be subject to platform minimums or fee rules
- renewal revenue goes to the club treasury, the platform, or a configured split

These three questions must be answered by the eventual monetization/governance specs:

- who sets renewal price
- how renewal revenue is split
- how grace-period usability works in the UI

## Auction

Auction is a product concept for scarce handles, not a protocol requirement for every handle.

Communities may choose to allocate premium handles via auction in order to:

- raise treasury funds
- distribute scarce names
- reserve short labels for high-signal allocation

V0 assumptions:

- only some handle lengths or reserved labels are auctionable
- auction proceeds follow club treasury policy
- auction does not change the fact that the resulting handle is still a licensed lease right, not absolute property

## Transfer And Revocation

If transfer is enabled by policy, a handle may be transferred or sold.

However, because handles are licensed rights rather than absolute property, club and platform policy may still constrain them.

Revocation should be narrow and policy-bound.

Valid revocation grounds may include:

- fraud
- invalid proof
- ToS violation
- explicit moderation policy violation
- issuance error

Revocation should not be treated as an arbitrary admin action.

## Owner-Managed vs Pirate-Managed Issuance

Namespace delegation determines whether Pirate can issue externally resolvable club handles automatically.

- `owner_managed`
  The root owner controls external resolver issuance directly.
- `pirate_managed`
  The root owner delegates SLD issuance authority to Pirate.

Implications:

- a club may still exist without Pirate-managed SLD issuance
- Pirate-managed `name.kanye` or `name@kanye` issuance requires `pirate_managed` delegation on the namespace
- without delegation, the owner remains responsible for actually issuing or publishing the external SLD even if Pirate tracks the handle right internally
- delegation is necessary for Pirate-managed external resolution, but not sufficient for public handle commerce; community-stage and governance preconditions may still keep claims, premium sales, or auctions disabled

## Reserved Labels

Each namespace may reserve labels for:

- moderation roles
- club operations
- governance roles
- brand or artist protection
- future auctions

Examples:

- `admin`
- `mod`
- `artist`
- `team`
- `vip`
- highly sensitive public names

Reserved-label policy is club-specific, subject to platform safety rules.

## Possible Later Contracts

If Pirate later moves this on-chain, likely contract areas would include:

- club handle registry
- lease / renewal accounting
- premium handle auction modules
- resolver adapters for HNS and Spaces

Those are implementation concerns and are intentionally out of scope for this domain spec.

## Open Questions

- What is the default renewal revenue split between club treasury and platform?
- Which labels must be reserved platform-wide across all namespaces?
- Should some handles be permanently non-transferable even if the namespace generally allows transfers?
