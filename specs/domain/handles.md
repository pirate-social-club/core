# Handles

Status: current working spec

Implementation status (2026-07-17):

- implemented in production: namespace-scoped quotes and claims (USD-cent pricing settled via
  USDC checkout), per-namespace handle policies and inventories including mirrors, claim
  eligibility gates (`claim_gate_mode = none | inherit_community | explicit`, including EVM
  asset-balance gate sources) enforced at claim time with non-consumptive holdings, owner
  reserve/revoke, reserved labels with per-label pricing, generated `.pirate` onboarding
  handles, paid `.pirate` upgrades
- claims for newly attached namespaces default to disabled; owners must deliberately configure
  policy and enable commerce
- protocol-level Spaces sub-space issuance (`spaces_subspace`) is disabled while the issuer
  stack is unavailable; namespace bindings without a policy row fail closed
- lifecycle decision: v0 claims are perpetual licensed rights; lease/grace/renewal is a
  deferred, explicitly versioned product mode and must not be retrofitted onto existing claims
- implemented in API main, pending the next pinned production release: quote/claim rate limits,
  one active paid label reservation per user and community, and normalized platform-reserved
  root-label rejection for both HNS and Spaces verification
- not yet implemented: optional lease/grace/renewal lifecycle, auctions, transfers, trust discounts,
  club-custom generated-name ontologies, and interactive bot protection
- externally resolvable handles additionally depend on the verification and authoritative-DNS
  infrastructure, which is not yet deployed

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
- perpetual in v0; a future namespace policy may offer leases only after the lifecycle is
  implemented end to end
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
- `lease_started_at` nullable, reserved for a future lease mode
- `lease_expires_at` nullable, reserved for a future lease mode
- `grace_ends_at` nullable, reserved for a future lease mode
- `issuance_mode`
- `issuance_chain` nullable
- `issuance_contract` nullable
- `issuance_token_id` nullable
- `issuance_source`
- `transferability`
- `created_at`
- `revision`
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
- `claim_gate_mode`
- `claim_gate_expression_ref` nullable
- `eligibility_timing`
- `label_claim_rules` (see [Per-Label Claim Rules](#per-label-claim-rules))
- future lease-mode fields (not accepted in v0): `lease_duration_days`,
  `grace_duration_days`, and `renewal_price_policy`
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
- `claim_gate_mode`
  - `none`: no token or community gate is evaluated for this namespace's claims
  - `inherit_community`: evaluate the club's current membership gate at claim time
  - `explicit`: evaluate the gate expression referenced by `claim_gate_expression_ref`, independently of the club's membership gate
- `claim_gate_expression_ref`
  Required when `claim_gate_mode = explicit` and null otherwise. The reference resolves to a versioned gate expression using the same gate primitives as community membership. Gate expressions belong to the namespace policy, so mirrors may require different assets from the primary namespace.
- `eligibility_timing`
  - `claim_time`: eligibility is evaluated atomically when the claim is committed; later loss of the qualifying asset does not invalidate the handle
  - `continuous`: eligibility is re-evaluated for continued use under an explicitly defined suspension and restoration policy

`gate_required_for_claim` is a legacy boolean shorthand for `claim_gate_mode = inherit_community`. New contracts and persisted policies should use the explicit model above rather than adding behavior to the boolean.

Claim-gate semantics:

- eligibility is namespace-local: passing the primary namespace gate does not imply eligibility for a mirror
- claim authorization must evaluate the selected namespace's policy; membership checks performed earlier in a session are not sufficient evidence
- gate evaluation and handle reservation must be bound to the same claim attempt so eligibility cannot be bypassed between quote and commit
- a qualifying holding is non-consumptive and non-exclusive by default; the same NFT or token balance may satisfy gates for multiple namespaces and users do not allocate or escrow assets to a handle
- exclusive or consumptive eligibility is outside v0 because it requires asset allocation, locking, or escrow semantics
- `continuous` is not a synonym for silent revocation; each policy must define suspension, restoration, grace, and resolution behavior before continuous enforcement can be enabled
- `trust_discount_policy`
  Optional future discount policy based on trusted native signals. Disabled by default in v0. See [karma.md](./karma.md) for the canonical karma model.

V0 defaults:

These defaults apply only once a namespace has enabled public community-local handle claims.
New public communities may carry a `standard` policy record while `club_local_handle_claims_enabled = false`.

- `claim_gate_mode = none`
- `claim_gate_expression_ref = null`
- `eligibility_timing = claim_time`

The `membership_gated` template instead defaults to `claim_gate_mode = inherit_community`.
An explicit per-namespace asset requirement must opt into `claim_gate_mode = explicit`
and identify its versioned expression.

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

## Per-Label Claim Rules

The namespace-level claim gate (`claim_gate_mode`) applies one eligibility policy to every
label in the namespace. Per-label claim rules extend that model so specific names can carry
their own eligibility requirements, for example: the label `charizard` is claimable only by
users who hold at least one Charizard card, while the rest of the namespace stays open.

### Model

A namespace handle policy may carry an ordered list of label claim rules:

- `label_claim_rule_id`
- `namespace_handle_policy_id`
- `position`
  Deterministic evaluation order; unique per policy.
- `selector`
  - `exact`: a bounded set of normalized labels this rule applies to
  - `any`: the rule applies to every label in the namespace
- `expression_json`
  A versioned gate expression using the same gate primitives, validation, and budget as
  community membership gates.

### Evaluation semantics

- rules are evaluated in `position` order against the normalized claim label; the first rule
  whose selector matches supplies the claim gate for that attempt, and later rules plus the
  namespace-level `claim_gate_mode` are not consulted for that label
- when no rule matches, the namespace-level `claim_gate_mode` behavior applies unchanged
- reserved labels, `claims_enabled`, `membership_required_for_claim`, pricing, and label
  validity checks are unaffected and are applied before rule evaluation; a rule can never
  make a reserved or invalid label claimable
- rule evaluation is bound to the same claim attempt as quote and commit, exactly like the
  namespace claim gate; the rule set consulted at commit is the persisted rule set at commit
  time, and eligibility must be re-evaluated at commit
- `eligibility_timing` applies to rule-derived gates the same way it applies to the
  namespace claim gate; rules do not introduce new timing semantics
- under `claim_time`, rules gate claims only; under `continuous`, the effective rule expression
  is snapshotted at claim and revalidated through the lifecycle below

### Label binding

A rule expression may reference the label being claimed:

- inside an `erc721_inventory_match` atom, a facet value may be the literal placeholder
  `{label}`; at evaluation time it is replaced by the normalized claim label before facet
  matching, using the same text normalization as inventory facet matching
- combined with an `any` selector, one rule expresses "a label is claimable only by holders
  of an asset whose facet value equals that label" — e.g. `subject = {label}` on a Courtyard
  graded-cards source makes `charizard` claimable only by Charizard-card holders, `gengar`
  only by Gengar-card holders, and so on, without enumerating labels
- the placeholder is valid only as a facet value of `erc721_inventory_match` atoms inside
  label claim rules; any other occurrence (other atom types, other fields, namespace-level
  claim gate expressions) must be rejected at save time
- a bound label that matches no facet value in the holder's inventory simply fails the atom;
  binding never widens a match

### Bounds and failure posture

- at most 20 rules per namespace policy
- at most 100 labels per `exact` selector; each entry must satisfy the v0 label rules and be
  stored normalized
- rule expressions share the community gate budget (depth and atom caps) and are validated
  with the same validator at write time and re-validated on read
- fail closed: a malformed persisted rule, selector, or expression makes the labels it
  selects unclaimable and surfaces an explicit evaluation error; it never falls through to
  the namespace default or to open claims
- provider outage during rule evaluation is reported as provider unavailability, distinct
  from ineligibility, and denies the claim

### Write model

- the rule list is replaced atomically as part of the handle-policy write; `position` is
  derived from array order; writers include existing rule ids to preserve durable identity,
  while ids are server-assigned for entries that omit one
- an existing rule id may only be reused within its owning namespace policy; unknown,
  cross-policy, and duplicate ids are rejected rather than silently re-minted
- each namespace policy has an independent, monotonically increasing integer `revision`; every
  successful policy write increments it in the same transaction as the rule replacement
- clients may send `expected_revision` as a compare-and-swap precondition; a stale value rejects
  the entire write with `409 Conflict` and returns the current policy so an editor can preserve
  its local draft while offering reload or explicit overwrite
- omitting `expected_revision` preserves legacy last-write-wins behavior
- writers must hold the same authority as for other handle-policy changes

## Continuous Eligibility Lifecycle

`eligibility_timing = continuous` closes the flash-claim path without watching every asset
transfer or silently revoking an identity mid-cycle. It is a platform revalidation lifecycle,
not lease expiry: perpetual ownership and eligibility state remain separate.

### Claim provenance

Every continuously eligible claim records an immutable grant snapshot:

- the effective, validated gate expression after any `{label}` substitution
- source (`namespace` or `label_rule`) and durable source id/version
- namespace policy id and policy version or content hash
- evaluator/provider identities and evaluation timestamp
- minimal qualifying evidence summary; custody inventory is represented by a provider proof id
  or evidence hash, never a raw private inventory dump

Revalidation asks whether the current owner satisfies that snapshotted expression, never whether
they still hold the same token id. Selling one qualifying asset and obtaining another equivalent
asset must not break the handle. Policy edits are prospective by default: changing or deleting a
rule does not rewrite existing grant snapshots. A future explicit migration may offer new terms to
existing holders, but must not do so implicitly during a policy save.

### Epoch and states

V1 uses platform constants rather than per-community knobs:

- successful eligibility is current for 90 days
- a definitive failed revalidation starts a 30-day grace window
- provider unavailability, timeout, or an internal/malformed-policy error is indeterminate and
  schedules a bounded retry; it does not start or advance holder grace

Eligibility state is stored independently from handle ownership `status`:

- `not_required`: claim-time-only or ungated handle
- `current`: continuously gated and within its successful revalidation epoch
- `grace`: definitive failure, but the handle remains publicly functional until `grace_ends_at`
- `suspended`: grace elapsed without requalification; ownership and label reservation remain,
  but the handle no longer renders as the owner's active community identity

Suspension does not release the label, transfer ownership, expire a perpetual license, or make the
label claimable by another user. Release and right-of-first-refusal semantics belong to a future
explicit lease policy. Requalification from either `grace` or `suspended` restores `current`
immediately and starts a new 90-day epoch.

### Revalidation paths

- a bounded, resumable scheduled sweep selects due handles by `eligibility_next_check_at`; work is
  shard-local, idempotent, lease-protected, and capped per invocation
- owners may call an authenticated `re-check now` action during `grace` or `suspended`; it uses the
  same evaluator and transition function as the sweep and is rate-limited
- evaluation uses the owner's currently active wallet attachments and current provider evidence
- concurrent sweeps and owner checks use a compare-and-set revision so stale outcomes cannot
  overwrite a newer success
- a successful result clears failure/grace fields; a definitive ineligible result preserves the
  original grace deadline rather than extending it on every retry

The API exposes owner-visible eligibility status, last/next check times, grace deadline, and a
coarse failure reason. It does not expose private qualifying evidence publicly.

### Notices and operations

Private owner notices are emitted idempotently when grace begins, seven days before its deadline,
one day before its deadline, and when suspension or restoration occurs. Public state does not
change during grace. Operator telemetry distinguishes definitive ineligibility, provider
unavailability, malformed snapshots, stale compare-and-set outcomes, and exhausted retries.

Policy writers must continue rejecting `continuous` until claim provenance persistence, the
scheduled sweep, owner-triggered recheck, suspension-aware rendering, restoration, and notices are
all deployed. Enabling the enum before the complete lifecycle exists is fail-open and forbidden.

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

## Lifecycle Semantics

V0 handles are perpetual licensed rights. They do not expire automatically, and the nullable
lease fields remain unset. "Perpetual" describes duration, not absolute ownership: policy-bound
revocation and platform ToS still apply.

This choice matches the commerce already shipped and prevents a future implementation from
silently imposing an expiry on a claim purchased without lease terms. Existing perpetual claims
must never be converted to leases without an explicit holder-facing migration and affirmative
consent.

A future lease mode may add:

- a lease start time
- an expiry time
- a grace period end time
- renewal pricing and payment semantics
- a sweep that moves expired rows through grace and expiry states
- holder notifications and renewal UI

Lease mode must ship as an explicit, versioned namespace policy. Until the complete lifecycle is
implemented, policy writers and claim paths must not advertise or persist lease terms.

## Future Renewal Semantics

Renewal behavior is a product-level rule, not contract-specific.

Future lease-mode requirements:

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
- auction does not change the fact that the resulting handle is still a licensed right, not absolute property

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
