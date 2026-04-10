# Profile

Status: draft

Related docs:

- [user.md](./user.md)
- [handles.md](./handles.md)
- [community.md](./community.md)
- [onboarding.md](./onboarding.md)
- [feed.md](./feed.md)
- [follow.md](./follow.md)
- [messaging.md](./messaging.md)
- [karma.md](./karma.md)
- [localization.md](./localization.md)

## Purpose

This doc defines Pirate's public and editable profile surface.

It covers:

- core profile fields
- extended profile fields
- visibility and privacy boundaries
- relationship to onboarding
- relationship to community-local handles

## Non-goals

This doc does not define:

- exact profile page UI
- follow graph features
- profile ranking or recommendations
- an onchain profile contract

## Core Principle

Onboarding should create a usable profile, not a fully populated one.

Pirate should keep the initial profile minimal and let users enrich it later.

## Profile Layers

Pirate should distinguish between:

- core profile
- extended profile
- community-local identity

### Core Profile

This is the default public profile surface every user may have.

Suggested v0 fields:

- `user_id`
- `global_handle`
- `global_handle_tier`
- `display_name` nullable
- `avatar_ref` nullable
- `banner_ref` nullable
- `bio` nullable
- `preferred_locale` nullable
- `links_json` nullable
- `created_at`
- `updated_at`

Notes:

- `global_handle` is the user's default Pirate-wide identity label, such as `suspicious-code-7234.pirate`
- `global_handle_tier`
  - `generated`
  - `standard`
  - `premium`
- `display_name` is user-facing and editable
- `preferred_locale` is the user's persisted app-locale preference used by SSR and localized read surfaces
- `global_handle` is the stable default identity surface before the user joins or claims community-local handles
- every user should have exactly one active `global_handle` in v0
- the initial generated `.pirate` handle should be a safe fallback identity, not a premium allocation
- in early-stage communities where community-local handles are not yet enabled, the user's global `.pirate` handle remains their default public identity inside those communities

### Profile Read-Model Extensions

Some profile read-model fields are defined in adjacent domain docs rather than repeated here.

In particular:

- follow-related read-model fields such as `viewer_follows`, `follower_count`, and `following_count` are defined in [follow.md](./follow.md)
- messaging capability read-model fields such as `dm_capabilities` are defined in [messaging.md](./messaging.md)

This doc treats those fields as valid profile-surface projections even though their source-of-truth logic is defined elsewhere.

### Global `.pirate` Handle Record

The active `global_handle` shown on profile should come from a dedicated record, not only a flat field copied onto the profile row.

Suggested v0 shape:

- `global_handle_id`
- `user_id`
- `label`
- `status`
- `tier`
- `issuance_source`
- `price_paid_usd` nullable
- `free_rename_consumed`
- `issued_at`
- `replaced_at` nullable
- `redirect_target_global_handle_id` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `status`
  - `active`
  - `redirect`
  - `retired`
- `tier`
  - `generated`
  - `standard`
  - `premium`
- `issuance_source`
  - `generated_signup`
  - `free_cleanup_rename`
  - `reddit_verified_claim`
  - `paid_upgrade`
  - `admin_grant`

Rules:

- one `user_id` may have exactly one `active` global handle in v0
- active global-handle labels must be unique platform-wide in v0
- a practical implementation may enforce this with a partial unique index on `label` where `status = active`
- `profile.global_handle` is a convenience projection of the current active global handle record
- historical `.pirate` handles remain in the table for auditability
- the active global handle record is the source of truth for lifecycle and paid-upgrade history
- when a handle record moves to `redirect`, `redirect_target_global_handle_id` should point to the replacement active handle record
- `price_paid_usd = null` is the expected value for `generated_signup` and `free_cleanup_rename`
- global `.pirate` handles do not use the club-handle lease model from [handles.md](./handles.md)
- `issuance_source` values in this record are specific to global `.pirate` handles and do not reuse the club-handle `issuance_source` enum

### Extended Profile

Extended profile fields are optional and should not be required during onboarding.

Suggested v0 shape:

- `user_profile_extended`
  - `user_id`
  - `languages_json` nullable
  - `location_city_id` nullable
  - `location_region_text` nullable
  - `skills_text` nullable
  - `interests_json` nullable
  - `favorite_clubs_json` nullable
  - `website_url` nullable
  - `updated_at`

Recommended interpretation:

- this layer is profile enrichment, not identity proof
- it should be editable after onboarding
- it should remain offchain in v0

## Public vs Sensitive Fields

Not every verified or collected user field belongs on the public profile.

Rules:

- raw provider payloads, document fields, nullifiers, and verification-session evidence must not appear on the public profile
- Pirate may expose a selected public trust projection on the profile when product policy intentionally chooses public disclosure
- public trust rendering should use normalized labels and compact derived values rather than raw provider responses
- privacy-sensitive demographic fields from old Pirate should not be part of default v0 onboarding

### Public Trust Projection

Pirate may treat profile as a public trust surface rather than a profile-only biography surface.

Recommended v0 public trust fields:

- `primary_wallet_address` nullable
- `verification_capabilities.unique_human`
- `verification_capabilities.age_over_18`
- `verification_capabilities.nationality`
- `verification_capabilities.wallet_score`

Recommended interpretation:

- the primary wallet address may be shown publicly when Pirate chooses to make wallet-linked social and trust state legible on profile
- `age_over_18` should render as a compact fact such as `18+`, not as date-of-birth or exact age
- nationality should render as a normalized public qualifier such as `AR National`, not raw document metadata
- wallet score should render as a compact trust input such as score and pass/fail state, not a full stamp dump by default
- `unique_human` may render as a normalized provider-neutral state such as `Verified Human`
- public trust projection is a read-model decision; the canonical verification and wallet tables remain the source of truth

Boundaries:

- public trust projection should expose only the current accepted derived state, not historical verification rows
- if Pirate makes trust public, profile reads should return the same normalized trust projection on both self and public profile endpoints
- product may still choose to hide specific public trust fields behind user settings later, but the default product contract may treat them as public
- wallet attachments beyond the chosen public primary wallet should remain out of the public profile by default

## Relationship To Onboarding

Onboarding should only set:

- auth/session
- generated global handle
- initial `preferred_locale` inferred from server locale resolution when available
- optional handle rename
- optional broad interests
- optional Reddit import bootstrap

Everything else should be editable later from profile settings.

Locale rule:

- `preferred_locale` should be first-class editable profile state in v0 rather than a browser-only implicit behavior
- onboarding does not need to ask the user to choose a locale explicitly, but Pirate may persist an inferred initial locale and let the user edit it later

## Global `.pirate` Handle Lifecycle

The global `.pirate` handle is Pirate's default identity layer.

Recommended v0 lifecycle:

1. generate a unique starter handle at signup
2. allow one free cleanup rename during onboarding or early account setup
3. allow later paid upgrades into better available `.pirate` names

Examples:

- starter: `suspicious-code-7234.pirate`
- cleaned-up standard: `technohippie.pirate`
- later premium upgrade: `techno.pirate`

Rules:

- one `user_id` has exactly one active `global_handle` in v0
- a better `.pirate` handle replaces the active one rather than adding another active global identity
- previous global handles may be retained only as internal history or redirects, not as concurrently active identities
- premium upgrades should be handled by Pirate policy, not by treating `.pirate` as an unlimited inventory system

### Free Cleanup Rename Window

The initial cleanup rename should be narrowly bounded.

Recommended v0 rule:

- one free cleanup rename per user
- valid only within the first `7 days` after account creation
- tracked on the active global handle lifecycle as `free_rename_consumed = true`
- once consumed or expired, later global-handle changes follow the paid upgrade policy

### Old Global Handle Disposal

V0 should optimize for identity clarity, not handle recycling.

Recommended rule:

- when a global handle is replaced, the old record moves to `redirect`
- redirected old `.pirate` handles should not be reissued to a different user in v0
- Pirate may later retire or recycle them under an explicit migration or governance policy, but not by default

This avoids impersonation-style confusion and keeps redirect behavior simple in v0.

## Global `.pirate` Tier Policy

The global `.pirate` namespace needs a minimal v0 tier policy, even if the full marketplace for names comes later.

Recommended v0 defaults:

- `generated`
  - auto-assigned at signup
  - free
  - not user-chosen
- `standard`
  - `8+` characters
  - one free cleanup rename during the first 7 days
  - later standard-handle changes may be a flat paid upgrade
- `premium`
  - `7` characters: paid-only
  - `6` characters: paid and manually reviewed
  - `1-5` characters: reserved, auction-only, or admin-assigned

Directional v0 pricing:

- post-onboarding standard rename: flat platform-set USD fee
- `7` character premium: fixed premium USD price
- `6` character premium: manual review with fixed premium price or curated sale
- `1-5` character premium: not normal self-serve inventory in v0

Actor rule:

- paid `.pirate` upgrades are initiated only by the authenticated user changing their own active global handle, unless an explicit admin-grant path is used

The exact price table can evolve later, but these eligibility tiers should be fixed now.

## Relationship To Reddit Bootstrap

Verified Reddit import may improve the user's initial global identity experience.

Recommended v0 behavior:

- a verified Reddit username may unlock a cleaner exact-match or near-exact-match `.pirate` suggestion
- this is a priority onboarding benefit, not a permanent exclusive right to all matching names
- if the exact match is unavailable, Pirate may suggest a close clean variant or keep the generated default until the user chooses a later upgrade

### Reddit Username Fallback

Recommended v0 fallback order when the exact `.pirate` match is unavailable:

1. exact normalized Reddit username
2. exact normalized username with numeric suffix, such as `name-1`
3. exact normalized username with short disambiguator, such as `name-xyz`
4. keep the generated starter handle and offer later manual choice

Do not generate cute adjective variants here. The fallback should stay deterministic and low-surprise.

## Generated Handle Algorithm

Generated `.pirate` handles should be readable, unique, and low-risk.

Recommended v0 scheme:

- `adjective-noun-4digits.pirate`

Example:

- `suspicious-code-7234.pirate`

Rules:

- generated words should come from an allowlisted vocabulary
- generated handles must pass a profanity and reserved-word filter
- numeric suffix should be random enough to avoid obvious collisions
- the generation algorithm should be deterministic only after the final chosen label is committed, not guessable from `user_id`

## Relationship To Community-Local Handles

The global profile is not the same as community-local identity.

Examples:

- global: `suspicious-code-7234.pirate`
- community-local: `alex.kanye`
- community-local: `alex@kanye`

Rules:

- every user should have one global Pirate identity surface
- community-local handles remain namespace-local and optional
- public profile rendering may show both the global handle and owned community-local handles
- current club views should prefer the namespace-local handle when one exists

## Reserved Global `.pirate` Labels

The global `.pirate` layer needs explicit platform-wide reservations.

Recommended initial reserved labels:

- `admin`
- `support`
- `pirate`
- `help`
- `mod`
- `staff`
- `official`
- `security`

Additional platform-reserved labels may be added over time.

## Identity Rendering Precedence

Recommended v0 rendering rules:

- community-scoped views should show the author's active community-local handle for that club when it exists
- if no matching community-local handle exists, fall back to the active global `.pirate` handle
- mixed global feeds such as `Home` and `Your Communities` should show the active global `.pirate` handle as the primary identity label
- mixed global feeds may show the post's community-local handle as a secondary badge or metadata line

## On-chain vs Off-chain

Recommended v0 split:

- profile data lives in Pirate's app model
- there is no dedicated v0 Pirate profile contract requirement
- old Pirate's heavy Base-side profile model should not be carried forward as-is into v2

## Open Questions

- Should `global_handle` be permanently user-visible, or may users later hide it behind display-name-first UI?
- Which extended profile fields should be public by default versus opt-in visibility?
