# User

Status: draft

Related docs:

- [attestations.md](./attestations.md)
- [community.md](./community.md)
- [handles.md](./handles.md)
- [profile.md](./profile.md)
- [follow.md](./follow.md)
- [messaging.md](./messaging.md)
- [blocks.md](./blocks.md)
- [onboarding.md](./onboarding.md)
- [post.md](./post.md)
- [monetization.md](./monetization.md)
- [karma.md](./karma.md)

## Purpose

This doc defines Pirate's canonical user object.

It covers:

- stable internal user identity
- connected wallets and auth-provider links
- verification sessions and verified identity records from supported providers
- provider-backed attestation inventory
- age and jurisdiction handling
- external trust imports such as Reddit
- profile identity versus community-local identity

## Non-goals

This doc does not define:

- exact Privy SDK integration details
- exact provider contract, attestation, or proof formats
- full social graph features such as follows and blocks
- full profile UI shape

## Core Principle

Pirate uses an opaque internal `user_id` as the canonical user identity from day one.

Wallets are attachments.
Privy identities are attachments.
Community-local handles are projections.

This avoids carrying forward the old address-first model where too much behavior is keyed directly by wallet address.

## Canonical IDs

Users use opaque app-issued IDs.

Examples:

- `user_id = usr_01...`
- `wallet_attachment_id = wal_01...`
- `verification_proof_id = vpr_01...`
- `external_reputation_snapshot_id = ers_01...`

## V0 User Shape

Suggested v0 fields:

- `user_id`
- `primary_wallet_attachment_id` nullable
- `verification_state`
- `capability_provider` nullable
- `verification_capabilities`
- `verified_at` nullable
- `date_of_birth` nullable
- `age_at_verification` nullable
- `nationality` nullable
- `identity_nullifiers` relation
- `verification_session_id` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `verification_state`
  - `unverified`
  - `pending`
  - `verified`
  - `reverification_required`
- `capability_provider`
  - `self`
  - `very`
  - Convenience summary for the provider that produced the most recent accepted core capability set. Null when `verification_state = unverified`.
- `verification_capabilities`
  - Structured per-capability derived state; see Verification Capabilities below.

Notes:

- `user_id` is the stable domain identity used by communities, posts, handles, and monetization
- public profile fields such as `display_name`, `avatar_ref`, `bio`, and `global_handle` live in [profile.md](./profile.md)
- `primary_wallet_attachment_id` is a convenience pointer only; it does not replace the wallet attachment history
- `verification_state` is a derived convenience summary, not the source of truth
- `verification_capabilities` is the authoritative per-capability state used by gate evaluation, voting eligibility, and feature degradation; `verification_state` is a coarse summary of `verification_capabilities.unique_human`
- `verification_capabilities` is also the v0 source of truth for eligible disclosed identity claims; see [identity-presentation.md](./identity-presentation.md)
- per-capability `provider` fields inside `verification_capabilities` are authoritative when different capabilities originate from different providers; `capability_provider` is only a convenience summary
- `user_attestations` is the durable source layer for provider-backed facts that do not belong in the small core `verification_capabilities` read model, but it should be modeled as a related collection owned by [attestations.md](./attestations.md), not as an inline user-row column
- `date_of_birth`, `age_at_verification`, and `nationality` reflect the user's current accepted verified identity in v0
- identity nullifier hashes are stored in the provider-keyed `identity_nullifiers` relation, not as an editable user-row field
- some sensitive verified-identity fields such as `date_of_birth`, `age_at_verification`, provider nullifiers, and `verification_session_id` may remain server-side in v0 even when they exist on the canonical user model; public API schemas may expose only the derived or lower-sensitivity subset they need
- `verification_session_id` points to the session that produced the current accepted verified identity
- `age_at_verification` is intentionally stored in v0 to preserve the exact age that was proven at verification time, even though current age can later be recomputed from `date_of_birth`
- identity nullifiers are for uniqueness enforcement only; they must never be used as the seed for anonymous label derivation — see [community.md](./community.md) for anonymous identity rules
- the active nullifier uniqueness constraint must be scoped by `(provider, mechanism, nullifier_hash)` so Self, Very, and future providers do not collide across distinct nullifier domains

### Verification Capabilities

`verification_state` is a coarse summary that masks the fact that different product features depend on different aspects of the verification payload.

### Provider Model

Pirate uses a provider-agnostic verification layer. Supported v0 providers:

- `self` — provides `unique_human`, `age_over_18`, `nationality`, and a document-derived `gender` marker in public v0; may later disclose additional document/person fields when a specific flow requests them
- `very` — provides `unique_human`; may also support a provider-specific `Palm Scan` qualifier layer
- `passport` — provides `wallet_score` and selected provider-backed proofs such as `gov_id`, `phone`, and `sanctions_clear`
- `zkpass` — may support schema-backed third-party attestations such as service-usage thresholds through registered provider schemas; see [attestations.md](./attestations.md)

A provider may offer one or more capabilities. A capability is satisfied when the user has a current accepted verification from a provider that offers it.

Gate evaluation should match on capabilities, not on providers. See [community.md](./community.md) under Community Gates.

Qualifier note:

- qualifier rendering may still reference provider-specific verification facts even when the gate model stays provider-neutral
- Self is especially important here because its disclosure set is variable per flow
- a Pirate flow may request only `minimumAge`, or may additionally request disclosures such as `nationality` or a document-derived `gender` marker
- public qualifier rendering should use a small safe subset such as `18+`, `US National`, `Document marker M`, or `Document marker F`, not raw document fields

### Self Capability Acquisition Model

Self should be modeled as progressive capability acquisition, not as one monolithic identity ceremony and not as per-community re-verification.

Recommended v0 rules:

- Self verification sessions request a capability set, not a generic "verify with Self" blob
- the server should request only the missing capabilities needed for the current product action
- if the requested set includes `age_over_18` or `nationality`, the session should also satisfy `unique_human`
- completed Self sessions should mint or refresh only the capabilities they actually proved, while preserving any previously accepted capabilities on the user
- users should experience this as account-level upgrade, not as community-specific repeated verification

Examples:

- a user with `very` `unique_human` joins a Self 18+ community
  - Pirate requests Self `age_over_18`
- a user with Self `unique_human` and `age_over_18` joins a nationality-gated community
  - Pirate requests Self `nationality`
- once a capability is accepted, later communities should reuse it until it expires or is revoked

This keeps Self additive and reusable instead of making every Self-backed community feel like a fresh onboarding flow.

### Proof Model

Pirate should model verification using explicit provider capabilities and proof mechanisms rather than a generic assurance tier.

Core layers:

- `user_attestations`
  - raw provider-backed facts and metadata
  - example: a Self nullifier proof, a Very palm verification, or a Human Passport score response
- `verification_capabilities`
  - compact derived read model used by most product gates
  - example: `unique_human`, `age_over_18`, `nationality`, `wallet_score`
- policy requirements
  - action-specific proof requirements
  - example: "root-attached community creation requires `unique_human` from `self` or `very`"

Suggested v0 proof types:

- `unique_human`
  - one-person-one-account uniqueness proof
- `biometric_liveness`
  - live biometric capture was verified
- `wallet_score`
  - composite wallet-based anti-Sybil score
- `gov_id`
  - government-ID-backed verification
- `age_over_18`
  - age verified as 18+
- `nationality`
  - nationality disclosed through an accepted proof flow
- `gender`
  - disclosed document marker claim from an accepted proof flow
- `sanctions_clear`
  - sanctions-screened or "clean hands" proof

Suggested v0 provider mechanisms:

| Provider | Capability | Mechanism |
|---|---|---|
| `self` | `unique_human` | `zk-nullifier` |
| `self` | `biometric_liveness` | `zk-biometric` |
| `self` | `age_over_18` | `zk-age` |
| `self` | `nationality` | `zk-nationality` |
| `self` | `gov_id` | `zk-gov-id` |
| `very` | `unique_human` | `palm-nullifier` |
| `very` | `biometric_liveness` | `palm-scan` |
| `passport` | `wallet_score` | `stamps-api-v2` |
| `passport` | `gov_id` | `HolonymGovIdProvider` |
| `passport` | `phone` | `HolonymPhone` |
| `passport` | `sanctions_clear` | `CleanHands` |

Recommended v0 product posture:

- root-attached community creation must require `unique_human` from biometric/nullifier providers such as `self` or `very`
- posting eligibility must require `unique_human` from biometric/nullifier providers such as `self` or `very`
- voting eligibility must require `unique_human` from biometric/nullifier providers such as `self` or `very`
- anonymous posting eligibility must require `unique_human` from biometric/nullifier providers such as `self` or `very`
- community join eligibility must require at least one approved platform trust credential:
  - `unique_human` from `self` or `very`
  - `wallet_score` from Human Passport above the platform threshold
  - an operator-whitelisted token-holding gate
- nationality-backed regional pricing should require `nationality` from `self`
- a club or commerce surface that relies only on `very` for identity can still satisfy `unique_human`, but it cannot use nationality-tiered pricing until it also accepts `self` nationality proofs
- wallet-score systems such as Human Passport should be available for softer anti-Sybil and community-entry gates, not as the sole proof for high-trust actions
- token-holding gates are operator-controlled exceptions, not public-v0 write or join policy; they may not substitute for `unique_human` requirements on posting, voting, community creation, or anonymous posting
- public-v0 Self-backed community gating should support:
  - `unique_human`
  - `age_over_18`
  - `nationality`
  - `gender` as a Self document-marker gate
- `sanctions_clear` should remain a canonical capability rather than a provider-specific Self toggle, and public-v0 community UX should not expose raw Self `ofac` or `excluded_countries` settings as direct user-facing knobs
- Self OFAC-backed `sanctions_clear` is deferred until Pirate pins the verifier response polarity and fail-closed parser behavior; public v0 should rely on Human Passport-backed sanctions state only

### Capability Shape

Suggested v0 `verification_capabilities` structure:

- `unique_human`
  - `state`: `unverified` | `pending` | `verified` | `expired`
  - `provider`: `self` | `very`
  - `proof_type`: `unique_human`
  - `mechanism`: `zk-nullifier` | `palm-nullifier`
  - `verified_at` nullable
- `age_over_18`
  - `state`: `unverified` | `verified` | `expired`
  - `provider`: `self`
  - `proof_type`: `age_over_18`
  - `mechanism`: `zk-age`
  - `verified_at` nullable
- `nationality`
  - `state`: `unverified` | `verified` | `expired`
  - `value`: nullable ISO country code
  - `provider`: `self`
  - `proof_type`: `nationality`
  - `mechanism`: `zk-nationality`
  - `verified_at` nullable
- `gender`
  - `state`: `unverified` | `verified` | `expired`
  - `value`: nullable document marker `M` | `F`
  - `provider`: `self`
  - `proof_type`: `gender`
  - `verified_at` nullable
- `sanctions_clear`
  - `state`: `unverified` | `verified` | `expired`
  - `provider`: `passport`
  - `proof_type`: `sanctions_clear`
  - `mechanism`: `CleanHands`
  - `verified_at` nullable
- `wallet_score`
  - `state`: `unverified` | `verified` | `expired`
  - `provider`: `passport`
  - `proof_type`: `wallet_score`
  - `mechanism`: `stamps-api-v2`
  - `score`: nullable decimal
  - `score_threshold`: nullable decimal
  - `passing_score`: nullable boolean
  - `last_score_timestamp`: nullable timestamp
  - `expiration_timestamp`: nullable timestamp

Additional v0 note:

- `gender` should be treated as an optional, high-sensitivity document-marker capability and gate primitive
- communities using `gender` gates should do so intentionally and be shown moderator/admin warnings that the underlying Self disclosure is a document marker, currently limited to `M` or `F`, not a broad identity claim
- provider-specific qualifiers such as `Palm Scan` from `very` may be exposed through the qualifier template layer without becoming new provider-neutral gate capabilities
- schema-backed provider attestations such as `zkpass` proofs should live in `user_attestations`, not as ad hoc new top-level capability fields
- Human Passport stamp detail should live in `user_attestations` even when the derived `wallet_score` capability is surfaced in `verification_capabilities`

### Capability Lifecycle

Verification capabilities need an explicit lifecycle, not just a state enum.

Recommended public-v0 posture:

- capabilities should remain reusable account-level facts until they expire, are revoked, or are replaced by a fresher accepted proof
- public v0 should use a conservative server-controlled TTL for accepted interactive identity capabilities rather than assuming indefinite validity
- for Self-backed `unique_human`, `age_over_18`, and `nationality`, Pirate should use a simple time-based expiry model in v0
- Pirate may store provider expiry metadata, but the effective product expiry should resolve to the earlier of:
  - the provider-reported expiry when available
  - Pirate's own product TTL ceiling
- a good public-v0 default is `90 days`
- refresh should be reactive in public v0:
  - when a gated action needs a capability whose state is now `expired`, Pirate starts a fresh verification session for the missing capability set
- refresh should use the same acquisition flow as the original proof
- Pirate should not rely on background refresh or silent provider-side renewal in public v0
- Pirate should not use grace windows in public v0; once the capability is expired, the next gated action requiring it should trigger refresh

Examples:

- `unique_human = verified`, `age_over_18 = expired`
  - non-age-gated communities continue to work
  - 18+ community join or post-access flows trigger a fresh Self age proof
- `nationality = expired`
  - nationality-gated communities or nationality-backed commerce flows trigger a fresh Self nationality proof
- `unique_human = expired`
  - posting, voting, community creation, and any other baseline-human gate should require refresh before continuing

This keeps the lifecycle understandable and aligns with Pirate's capability-by-capability gate model.

Derived-state interpretation for `unique_human`:

- `unverified`
  No accepted current verification from any provider
- `pending`
  A verification session is in progress, but no accepted verified record exists yet
- `verified`
  A current accepted verified record exists from a supported provider
- `expired`
  The user has historical verification data, but product policy requires a fresh verification before some gated action

Coarse `verification_state` derivation:

- `verification_state = unverified` when `unique_human.state = unverified`
- `verification_state = pending` when `unique_human.state = pending`
- `verification_state = verified` when `unique_human.state = verified`
- `verification_state = reverification_required` when `unique_human.state = expired`

If a user's verification becomes stale or is revoked, some capabilities may degrade independently. For example:

- loss of fresh re-verification should not immediately deanonymize existing anonymous posts; see [community.md](./community.md) for anonymous identity rules
- loss of nationality proof should not revoke posting ability if posting does not require nationality
- loss of age proof should not revoke posting ability in non-age-gated communities

## Wallet Attachments

Wallets are append-only attachments to the user, not the user's canonical identity.

Suggested v0 wallet attachment shape:

- `wallet_attachment_id`
- `user_id`
- `chain_namespace`
- `wallet_address`
- `status`
- `is_primary`
- `verified_at`
- `created_at`

Suggested meanings:

- `chain_namespace`
  - `eip155`
  - `solana`
  - later other chain families if needed
- `status`
  - `active`
  - `revoked`

Rules:

- a user may attach multiple wallets over time
- at most one active wallet attachment should be marked `is_primary = true` in v0
- wallets may be disconnected or rotated without changing `user_id`
- posts, communities, and handles must reference `user_id`, not raw wallet addresses
- active wallet attachments must be unique on `(user_id, chain_namespace, wallet_address)`
- an active wallet address may belong to only one user at a time in v0
- if wallet ownership is ever transferred between users, the old attachment must be revoked before a new active attachment is created

## Wallet Product Surface

Wallets should have a first-class product path without turning wallet address into the user's canonical identity.

Recommended v0 posture:

- Pirate should expose a dedicated wallet hub rather than burying all wallet operations inside generic settings
- the wallet hub is the operational surface for wallet-linked capabilities
- profile may still expose the chosen public primary wallet as a public trust projection
- settings may still deep-link into wallet management, but should not be the only truthful entry point

Recommended wallet-hub responsibilities:

- show all active wallet attachments and their chain families
- set or change the current primary wallet attachment
- show capability readiness for wallet-dependent product actions
- explain which wallet path Pirate will use for follow, settlement, and locked-asset reads
- present the next required action when the current wallet state is insufficient

Examples of wallet-hub readiness states:

- no wallet attached
- primary wallet ready
- settlement wallet required
- reconnect wallet
- switch to entitled wallet
- unsupported chain for this action

Important boundary:

- the wallet hub is a first-class app path, not a second identity system
- `user_id` remains the canonical Pirate subject
- wallet addresses remain capability inputs and public trust signals where product policy chooses to expose them

## Capability-Specific Wallet Resolution

One global `is_primary` flag is a convenience pointer, not the full product contract for wallet-linked actions.

Recommended v0 rule:

- Pirate may keep one global primary wallet attachment
- wallet-dependent features should still resolve against explicit capability rules rather than assuming every feature uses the same exact wallet path forever

Recommended v0 capability defaults:

- profile public wallet
  - defaults to the user's current primary active EIP-155 wallet attachment
- follow
  - defaults to the user's canonical EFP-capable EIP-155 wallet attachment
  - the write path remains Base-backed as defined in [follow.md](./follow.md)
- Story purchase settlement
  - defaults to the user's current primary active EIP-155 wallet attachment unless the purchase flow explicitly selects another eligible EIP-155 attachment
- Story CDR locked-asset read
  - should use the buyer wallet that actually holds or can prove the entitlement needed for the locked read
  - in v0 this should normally be the same EIP-155 wallet path used for purchase settlement unless Pirate later introduces explicit entitlement-wallet selection
- scrobble anchoring
  - defaults to the current primary active EIP-155 wallet attachment as defined below

Failure posture:

- if a feature needs a wallet family the user does not currently have, Pirate should return a wallet-required or switch-wallet state
- Pirate should not silently fall back to an unrelated wallet family just because some wallet attachment exists
- the wallet hub should be the canonical place where these capability-specific requirements are made legible to the user

## Phased Chain Support

Wallet support should expand by capability family, not by promising every chain everywhere at launch.

Recommended rollout:

- phase 1
  - EIP-155 wallets only for profile trust, follow, Story settlement, and Story CDR reads
  - honest user-facing support posture should center on Ethereum, Base, and Story-linked execution paths
- phase 1.5
  - Tempo may be added as a supported payment or funding method once Pirate has a concrete settlement mapping for it
  - Tempo should not be described as a fully general wallet family before that mapping exists
- deferred
  - Solana wallet support
  - Bitcoin wallet support

Reasoning:

- Solana is a separate wallet family and signing/runtime surface, not just another EIP-155 chain id
- Bitcoin-native support should not be implied when the real executable posture may still be a narrower routed funding lane
- Pirate should prefer an honest narrow support claim over broad "multi-chain" language that hides capability gaps

## Scrobble Wallet Resolution

Scrobble batch anchoring requires a resolved EIP-155 wallet address per user.

Recommended v0 rules:

- the canonical scrobble wallet defaults to the user's primary active EIP-155 wallet attachment
- if no active EIP-155 wallet attachment exists, the scrobble enters `awaiting_wallet` status and will not be anchored until a wallet is attached
- the `wallet_attachment_id` is pinned on the ingest event at acceptance time
- if the pinned wallet attachment is revoked before the scrobble is anchored, the anchor worker may re-resolve to the current primary wallet and update the pin
- wallet resolution for scrobbles follows the same pattern as follow resolution; see [follow.md](./follow.md)

This is an internal resolution detail. The public scrobble API does not expose `wallet_attachment_id`.

## Auth Provider Links

Privy should be treated as an auth-provider attachment, not as the canonical user identity.

Suggested v0 auth-provider link shape:

- `auth_provider_link_id`
- `user_id`
- `provider`
- `provider_subject`
- `created_at`
- `updated_at`

Suggested meanings:

- `provider`
  - `jwt`
  - `privy`

Rules:

- one user may have one or more auth-provider links over time
- `provider_subject` is an external provider identity, not a substitute for `user_id`
- session handling may start from JWT or Privy in v0, but domain objects should not
- auth-provider links must be unique on `(provider, provider_subject)`

## Verification Sessions

Verification sessions are append-only process records produced by a specific provider.

The current working model in `pirate/` is a composite verification flow. Pirate v2 generalizes this into a provider-parameterized session model while preserving the session lifecycle.

The API persists:

- verification sessions in `verification_sessions`
- a current accepted identity snapshot for the user
- a current Human Passport-derived `wallet_score` capability through server-side refresh and read flows, not through interactive verification sessions

Pirate v2 should preserve the session shape conceptually while moving the canonical subject from wallet address to `user_id` and adding `provider` as a first-class field.

### Verification Sessions

Verification sessions are append-only process records.

Suggested v0 session shape:

- `verification_session_id`
- `user_id`
- `provider`
- `provider_mode` nullable
- `requested_capabilities`
- `wallet_attachment_id` nullable
- `verification_intent` nullable
- `policy_id` nullable
- `status`
- `date_of_birth` nullable
- `age_at_verification` nullable
- `nationality` nullable
- `attestation_id` nullable
- `proof_hash` nullable
- `launch` nullable
- `callback_path` nullable
- `verified_at` nullable
- `created_at`
- `expires_at`
- `failure_reason` nullable
- `evidence_ref`

Suggested meanings:

- `provider`
  - `self`
  - `very`
- `provider_mode`
  - `qr_deeplink`
  - `widget`
- `requested_capabilities`
  - one or more of:
    - `unique_human`
    - `age_over_18`
    - `nationality`
    - `gender`
- `verification_intent`
  - `profile_verification`
  - `community_creation`
  - `post_access_18_plus`
  - `commerce_pricing`
  - `qualifier_disclosure`
- `status`
  - `pending`
  - `verified`
  - `failed`
  - `expired`

Important v0 boundary:

- interactive verification sessions are for `self` and `very` only
- `self` uses `provider_mode = qr_deeplink`
- `very` public-v0 verification uses `provider_mode = widget`
- Human Passport `wallet_score` is refreshed server-side and read through dedicated capability endpoints rather than through `verification_sessions`

Notes:

- `provider` identifies which verification system produced this session
- `proof_hash` should store a hash of the submitted proof payload
- `evidence_ref` points to Pirate-controlled verification evidence or attestation payload storage
- pending sessions expire if not completed
- successful re-verification replaces the current accepted identity fields on the user row in v0
- historical verification data is preserved in session history, not in multiple concurrent identity snapshots
- the working `pirate/` implementation mirrors parts of the accepted identity onchain, especially `verifiedAt` and `nationality`
- provider-specific fields such as `attestation_id` are stored on the session record but their semantics are provider-specific; the derived `verification_capabilities` on the user row is the provider-neutral interface

## Age Proof And 18+ Access

18+ access should be derived from the `age_over_18` capability in `verification_capabilities`, not from a stale cached boolean.

Rules:

- gated reads should verify that the user has `verification_capabilities.age_over_18.state = verified`
- current age should be computed from the stored verified `date_of_birth`
- if product policy later requires fresh re-verification, that should set `verification_capabilities.age_over_18.state = expired`; this degrades the `age_over_18` capability independently and does not change `verification_state`, which tracks `unique_human` only

This matches the post-side rule that `18+` gating is a viewer-access rule, not just a posting rule.

## Jurisdiction Proof

Jurisdiction-sensitive features should derive from the `nationality` capability in `verification_capabilities`.

Rules:

- posting or viewing restrictions based on nationality or jurisdiction should use `verification_capabilities.nationality.value`
- if jurisdiction policy later requires fresh re-verification, that should be handled at the session/identity layer rather than via a separate proof type in v0

## External Trust Imports

External trust imports are one-time snapshots, not ongoing syncs.

Reddit is the clearest v0 example.

Suggested v0 snapshot shape:

- `external_reputation_snapshot_id`
- `user_id`
- `source_platform`
- `snapshot_type`
- `source_account_handle`
- `proof_method`
- `captured_at`
- `snapshot_payload`

Suggested meanings:

- `source_platform`
  - `reddit`
- `snapshot_type`
  - `onboarding`
- `proof_method`
  - `profile_code`

Suggested Reddit `snapshot_payload` contents:

- `account_age_days: number`
- `global_karma: number | null`
- `subreddit_karma: Array<{ subreddit: string; karma: number }>`
- `moderator_of: string[]`

`snapshot_payload` is a JSON object captured at onboarding time.

Rules:

- the snapshot is immutable after capture
- refresh, if ever supported, should create a new snapshot record rather than mutating the old one
- imported trust must not become native Pirate karma
- imported trust must not produce karma events; see [karma.md](./karma.md)

## Profile Identity vs Community-Local Identity

Pirate has both global user identity and community-local identity.

Global identity:

- `user_id`
- profile display name
- avatar
- bio
- wallet attachments
- verification state and capabilities

Community-local identity:

- handles such as `name.kanye`
- moderation and reputation inside a specific club
- community-scoped visibility and social context

See [handles.md](./handles.md).

Rules:

- a user may exist without any community-local handle
- a user may have different handles in different communities
- a user may participate in many communities without any community-local handle, and this is expected for early-stage communities
- community-local handles do not replace the canonical `user_id`
- community karma is separate from global reputation; see [karma.md](./karma.md)

## Relationship To Posts And Communities

Rules:

- posts store `author_user_id`
- communities store `created_by_user_id`
- moderation, monetization, and handles should all anchor on `user_id`
- wallet address should be treated as an execution/auth detail, not the durable domain identity

## On-chain vs Off-chain

Recommended v0 split:

- `user_id` and proof records live in the app DB
- wallet ownership and chain activity remain externally verifiable facts
- verification providers may rely on external attestations, contracts, or their own proof infrastructure, but Pirate should still store its own proof records and derived state

## Open Questions

- Should v0 allow more than one active primary auth-provider link, or only one Privy link per user?
- Which Reddit metrics are worth surfacing on profile by default?
- Which profile fields should be mutable by the user versus derived from verified records?
