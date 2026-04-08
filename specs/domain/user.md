# User

Status: draft

Related docs:

- [guild.md](./guild.md)
- [handles.md](./handles.md)
- [profile.md](./profile.md)
- [onboarding.md](./onboarding.md)
- [post.md](./post.md)
- [monetization.md](./monetization.md)
- [karma.md](./karma.md)

## Purpose

This doc defines Pirate's canonical user object.

It covers:

- stable internal user identity
- connected wallets and auth-provider links
- Self.xyz verification sessions and verified identity records
- age and jurisdiction handling
- external trust imports such as Reddit
- profile identity versus guild-local identity

## Non-goals

This doc does not define:

- exact Privy SDK integration details
- exact Self.xyz contract or attestation formats
- full social graph features such as follows and blocks
- full profile UI shape

## Core Principle

Pirate uses an opaque internal `user_id` as the canonical user identity from day one.

Wallets are attachments.
Privy identities are attachments.
Guild-local handles are projections.

This avoids carrying forward the old address-first model where too much behavior is keyed directly by wallet address.

## Canonical IDs

Users use opaque app-issued IDs.

Examples:

- `user_id = usr_01...`
- `wallet_attachment_id = wal_01...`
- `self_verification_proof_id = svp_01...`
- `external_reputation_snapshot_id = ers_01...`

## V0 User Shape

Suggested v0 fields:

- `user_id`
- `primary_wallet_attachment_id` nullable
- `self_verification_state`
- `verified_at` nullable
- `date_of_birth` nullable
- `age_at_verification` nullable
- `nationality` nullable
- `identity_nullifier_hash` nullable
- `verification_session_id` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `self_verification_state`
  - `unverified`
  - `pending`
  - `verified`
  - `reverification_required`

Notes:

- `user_id` is the stable domain identity used by guilds, posts, handles, and monetization
- public profile fields such as `display_name`, `avatar_ref`, `bio`, and `global_handle` live in [profile.md](./profile.md)
- `primary_wallet_attachment_id` is a convenience pointer only; it does not replace the wallet attachment history
- `self_verification_state` is a derived convenience summary, not the source of truth
- `date_of_birth`, `age_at_verification`, `nationality`, and `identity_nullifier_hash` reflect the user's current accepted verified identity in v0
- `verification_session_id` points to the session that produced the current accepted verified identity
- `age_at_verification` is intentionally stored in v0 to preserve the exact age that was proven at verification time, even though current age can later be recomputed from `date_of_birth`
- `identity_nullifier_hash` is for uniqueness enforcement only; it must never be used as the seed for anonymous label derivation — see [guild.md](./guild.md) under Anonymous Subject Derivation

### Verification Scope

`self_verification_state` is a coarse summary that masks the fact that different product features depend on different aspects of the Self verification payload.

In v0, Self verification gates at least these distinct features:

- posting eligibility (anti-bot baseline)
- voting eligibility (karma anti-Sybil)
- age-gate satisfaction (`18+` content access)
- nationality-gate satisfaction (jurisdiction-sensitive features)
- anonymous posting eligibility (requires active verification to create anonymous posts)

If a user's verification becomes stale or is revoked, some of these features may need to degrade independently. For example:

- loss of fresh re-verification should not immediately deanonymize existing anonymous posts; see [guild.md](./guild.md) under Anonymous Lifecycle Rules
- loss of nationality proof should not revoke posting ability if posting does not require nationality
- loss of age proof should not revoke posting ability in non-age-gated guilds

Later versions should consider splitting `self_verification_state` into per-capability derived flags rather than relying on a single coarse state for all features.

Derived-state interpretation:

- `unverified`
  No accepted current verified identity record
- `pending`
  A Self verification session is in progress, but no accepted verified identity record exists yet
- `verified`
  A current verified identity record exists for the user
- `reverification_required`
  The user has historical Self verification data, but product policy requires a fresh verification before some gated action

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
- posts, guilds, and handles must reference `user_id`, not raw wallet addresses
- active wallet attachments must be unique on `(user_id, chain_namespace, wallet_address)`
- an active wallet address may belong to only one user at a time in v0
- if wallet ownership is ever transferred between users, the old attachment must be revoked before a new active attachment is created

## Auth Provider Links

Privy should be treated as an auth-provider attachment, not as the canonical user identity.

Suggested v0 auth-provider link shape:

- `auth_provider_link_id`
- `user_id`
- `provider`
- `provider_user_id`
- `created_at`
- `updated_at`

Suggested meanings:

- `provider`
  - `privy`

Rules:

- one user may have one or more auth-provider links over time
- `provider_user_id` is an external provider identity, not a substitute for `user_id`
- session handling may still rely on Privy in v0, but domain objects should not
- auth-provider links must be unique on `(provider, provider_user_id)`

## Self.xyz Verification

The current working model in `pirate/` is a composite Self verification flow, not separate age and jurisdiction proofs.

The API persists:

- verification sessions in `self_verifications`
- a current accepted identity snapshot for the user

Pirate v2 should preserve that shape conceptually while moving the canonical subject from wallet address to `user_id`.

### Verification Sessions

Self verification sessions are append-only process records.

Suggested v0 session shape:

- `self_verification_session_id`
- `user_id`
- `wallet_attachment_id`
- `status`
- `date_of_birth` nullable
- `age_at_verification` nullable
- `nationality` nullable
- `attestation_id` nullable
- `proof_hash` nullable
- `verified_at` nullable
- `created_at`
- `expires_at`
- `failure_reason` nullable
- `evidence_ref`

Suggested meanings:

- `status`
  - `pending`
  - `verified`
  - `failed`
  - `expired`

Notes:

- `proof_hash` should store a hash of the submitted proof payload
- `evidence_ref` points to Pirate-controlled verification evidence or attestation payload storage
- pending sessions expire if not completed
- successful re-verification replaces the current accepted identity fields on the user row in v0
- historical verification data is preserved in session history, not in multiple concurrent identity snapshots
- the working `pirate/` implementation mirrors parts of the accepted identity onchain, especially `verifiedAt` and `nationality`

## Age Proof And 18+ Access

18+ access should be derived from the verified identity record, not from a stale cached boolean.

Rules:

- gated reads should verify that the user has a current verified identity record
- current age should be computed from the stored verified `date_of_birth`
- if product policy later requires fresh re-verification, that should move the user to `self_verification_state = reverification_required`

This matches the post-side rule that `18+` gating is a viewer-access rule, not just a posting rule.

## Jurisdiction Proof

Jurisdiction-sensitive features should derive from the same verified identity record.

Rules:

- posting or viewing restrictions based on nationality or jurisdiction should use the stored verified `nationality`
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

## Profile Identity vs Guild-Local Identity

Pirate has both global user identity and guild-local identity.

Global identity:

- `user_id`
- profile display name
- avatar
- bio
- wallet attachments
- Self verification state

Guild-local identity:

- handles such as `name.kanye`
- moderation and reputation inside a specific guild
- guild-scoped visibility and social context

See [handles.md](./handles.md).

Rules:

- a user may exist without any guild-local handle
- a user may have different handles in different guilds
- guild-local handles do not replace the canonical `user_id`
- guild karma is separate from global reputation; see [karma.md](./karma.md)

## Relationship To Posts And Guilds

Rules:

- posts store `author_user_id`
- guilds store `created_by_user_id`
- moderation, monetization, and handles should all anchor on `user_id`
- wallet address should be treated as an execution/auth detail, not the durable domain identity

## On-chain vs Off-chain

Recommended v0 split:

- `user_id` and proof records live in the app DB
- wallet ownership and chain activity remain externally verifiable facts
- Self verification may rely on external attestations or contracts, but Pirate should still store its own proof records and derived state

## Open Questions

- Should v0 allow more than one active primary auth-provider link, or only one Privy link per user?
- Which Reddit metrics are worth surfacing on profile by default?
- Which profile fields should be mutable by the user versus derived from verified records?
