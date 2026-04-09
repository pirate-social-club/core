# Community

Status: draft

Related docs:

- [namespace.md](./namespace.md)
- [governance-backends.md](./governance-backends.md)
- [multisig-attachment.md](./multisig-attachment.md)
- [majeur-creation.md](./majeur-creation.md)
- [artist-identity.md](./artist-identity.md)
- [artist-catalog.md](./artist-catalog.md)
- [handles.md](./handles.md)
- [profile.md](./profile.md)
- [user.md](./user.md)
- [identity-presentation.md](./identity-presentation.md)
- [onboarding.md](./onboarding.md)
- [monetization.md](./monetization.md)
- [donations.md](./donations.md)
- [karma.md](./karma.md)
- [questions.md](./questions.md)
- [livestream.md](./livestream.md)
- [karaoke.md](./karaoke.md)
- [notifications.md](./notifications.md)

## Purpose

A `community` is the canonical social container for:

- posting
- moderation
- membership
- ranking
- karma within that community
- livestream and karaoke eligibility
- governance attachment

A community is not:

- a route
- a TLD
- a DAO
- an artist identity
- a subreddit

## Terminology

`community` is the durable internal and cross-system noun.

`club`, `village`, `town`, `city`, and `state` are user-facing scale tiers, not different base object types.

This means:

- the DB, API, and contracts should anchor on `community` and `community_id`
- UI and ranking surfaces may derive civic labels from a community's scale tier
- a community does not stop being the same object when it grows from club scale to state scale

## Civic Scale Tier

Suggested v0 field:

- `civic_scale_tier`

Suggested values:

- `club`
- `village`
- `town`
- `city`
- `state`

Suggested thresholds:

- `club`: under 100 members
- `village`: at least 100 members
- `town`: at least 1,000 members
- `city`: at least 10,000 members
- `state`: at least 100,000 members

Rules:

- `civic_scale_tier` is a derived or server-controlled classification, not a user-chosen type string
- tier changes do not create a new identity
- posts, memberships, handles, governance, and monetization stay attached to `community_id`
- product copy may choose whether to show the civic label or the generic word `community` depending on context

## Canonical IDs

Communities use opaque app-issued IDs, not sequential public integers and not route-derived IDs.

Examples:

- `community_id = gld_01...`
- `artist_identity_id = art_01...`

The API and specs should use opaque IDs only. Hidden numeric DB keys are allowed as implementation detail but are not canonical product IDs.

## Core State

V0 fields for `communities`:

- `community_id`
- `display_name`
- `description`
- `status`
- `artist_identity_id` nullable
- `artist_governance_state`
- `membership_mode`
- `default_age_gate_policy`
- `content_authenticity_policy`
- `content_authenticity_detection_policy`
- `source_policy`
- `community_agent_user_id` nullable
- `civic_scale_tier`
- `donation_partner_id` nullable
- `donation_policy_mode`
- `donation_partner_status`
- `governance_mode`
- `settings`
- `created_by_user_id`
- `created_at`
- `updated_at`

### Notes

- `artist_identity_id` is an optional internal pointer to a canonical artist record.
- A generic community can have `artist_identity_id = null`.
- The raw MusicBrainz MBID lives on the artist identity record, not directly on the community row.
- `community_agent_user_id` points to the app-level system actor allowed to publish community-agent content such as daily questions in v0.
- `content_authenticity_policy` is a structured community setting that defines which AI-assisted and AI-generated post categories are allowed.
- `content_authenticity_detection_policy` is a structured community setting that selects which platform-approved authenticity-detection profile Pirate should use for community-optional AI/deepfake analysis.
- `source_policy` is a structured community setting that defines how reposts, source attribution, and human-made fan works about identified people are handled.
- `donation_partner_id` points to the community's approved donation beneficiary when donation sidecars are enabled.
- `donation_partner_status` describes whether the community's attachment to that partner is currently usable for new donation-enabled listings.
- Namespace rows point to communities. See [namespace.md](./namespace.md) for the canonical namespace model.
- `created_by_user_id` assumes Pirate has a stable internal `user_id`; linked wallets or external accounts are separate attachments.
- `settings` is nullable in v0 and defaults to an empty object when omitted at creation time.

## Artist Linkage

Some communities are linked to a known artist. That linkage is optional.

Rules:

- `community.artist_identity_id` points to `artist_identities.artist_identity_id`
- `musicbrainz_artist_mbid` is optional but first-class when known
- a community should not store MBID as its primary artist identifier
- this leaves room for multiple external IDs later without changing community identity

See [artist-identity.md](./artist-identity.md).

## Why Community Is Durable

`community_id` is the canonical product object because:

- names can change
- civic scale tier can change
- TLD bindings can change
- governance can upgrade from creator control to multisig to Majeur
- artist governance participation can change
- route structures can change

If posts and membership attach directly to a route, TLD, DAO address, or scale label, those upgrades become migrations. Attaching them to `community_id` keeps the social object stable while names, labels, and governance evolve.

This does not imply Cloudflare Durable Objects. It means a durable application identity.

## State Machine

### Community Lifecycle

- `draft`
- `active`
- `frozen`
- `archived`
- `deleted`

Meanings:

- `draft`: created but not publicly resolvable yet
- `active`: public, postable, normal state
- `frozen`: readable, but posting or governance actions may be restricted
- `archived`: historical / read-only
- `deleted`: tombstoned app object

### Artist Governance State

- `fan_run`
- `claim_pending`
- `artist_governed`
- `org_governed`

Meanings:

- `fan_run`: community is about an artist, but the artist is not verified as participating in governance
- `claim_pending`: a claim exists that the artist or authorized org should participate in governance, but it is unresolved
- `artist_governed`: the artist is verified and actually participates in community governance
- `org_governed`: a verified organization acting on behalf of the artist participates in community governance
- non-artist communities default to `artist_governance_state = fan_run` in v0

### Governance Mode

- `centralized`
- `multisig`
- `majeur`

These are separate from lifecycle and artist governance state. Do not combine them into one mega-state machine.

Recommended product labels:

- `centralized` = `Creator-led`
- `multisig` = `Multisig`
- `majeur` = `Majeur DAO`

### Donation Policy Mode

- `none`
- `optional_creator_sidecar`
- `fundraiser_default`

### Content Authenticity Stance

- `human_only`
- `human_first`
- `ai_allowed_with_disclosure`
- `ai_allowed`

### Membership Mode

- `open`
- `request`
- `gated`

Public v0 launch posture:

- public community creation should expose only `open` and `gated`
- `request` remains modeled for deferred, internal, or later use
- public v0 should prefer explicit gates over moderator-approval queues for community admission

### Membership State Read Model

Community read models should expose the viewer's membership relationship to the community.

Suggested v0 `membership_state` values:

- `not_member`
- `pending_request`
- `member`
- `banned`

### Admission Workflow

Recommended v0 flow:

1. Viewer invokes the community join action.
2. If `membership_mode = open`, membership is created immediately.
3. If `membership_mode = request`, a membership-request row is created with `status = pending`.
4. If `membership_mode = gated`, authoritative membership-scope gate rules are evaluated.
5. Moderators or admins review pending requests.
6. Approval creates membership and resolves the request.
7. Rejection resolves the request without creating membership.

## Community Gates

Community gates are a community feature and should be modeled on the community, not in a separate spec.

Suggested v0 gate rule shape:

- `gate_rule_id`
- `community_id`
- `scope`
- `gate_family`
- `gate_type`
- `proof_requirements` nullable
- `chain_namespace` nullable
- `gate_config`
- `status`
- `created_at`
- `updated_at`

## Adult Communities

Communities may default to adult-only viewing.

Suggested v0 field:

- `default_age_gate_policy`
  - `none`
  - `18_plus`

Rules:

- if `default_age_gate_policy = 18_plus`, community viewing requires an explicit `age_over_18` proof from an accepted provider such as `self`
- creating a community with `default_age_gate_policy = 18_plus` requires the acting creator to satisfy the same `age_over_18` proof requirement
- updating an existing community from `default_age_gate_policy = none` to `default_age_gate_policy = 18_plus` requires the acting owner/admin to satisfy the same `age_over_18` proof requirement
- post-level or asset-level age gates may be stricter, but not looser, than the community default
- adult communities should still use post and asset safety classification; the community default is not a substitute for content scanning

## Platform-Minimum Content Constraints

Some content constraints are platform-level and are not community-configurable.

Rules:

- platform-required safety analysis still runs for every applicable upload regardless of community policy
- non-consensual sexual deepfakes, deceptive impersonation of real people, and unauthorized synthetic likeness content banned by platform policy must be unrepresentable in community settings
- community settings may be stricter than platform minimums but never looser
- UI should not render disabled toggles for platform-banned categories because that implies community choice where none exists

## Content Authenticity Policy

Communities should define AI-content policy as structured settings, not prose-only rules.

Suggested v0 field:

- `content_authenticity_policy`

Storage note:

- the stored community setting may be `null` at create time in public v0
- `null` does not mean "no policy" or "everything allowed"
- the server must resolve a restrictive effective default policy whenever no explicit community policy has been configured yet
- community activation must not be blocked on setting an explicit authenticity policy

Suggested v0 shape:

- `authenticity_stance`
  - `human_only`
  - `human_first`
  - `ai_allowed_with_disclosure`
  - `ai_allowed`
- `text_policy`
  - `allow_ai_assisted_editing`
  - `allow_ai_generated`
- `image_policy`
  - `allow_ai_upscale`
  - `allow_ai_restoration`
  - `allow_generative_editing`
  - `allow_ai_generated`
- `video_policy`
  - `allow_ai_upscale`
  - `allow_ai_restoration`
  - `allow_ai_frame_interpolation`
  - `allow_generative_editing`
  - `allow_ai_generated`
- `song_policy`
  - `allow_ai_assisted_mastering`
  - `allow_ai_stem_separation`
  - `allow_ai_generated_instrumentals`
  - `allow_ai_generated_lyrics`
  - `allow_ai_generated_vocals`

Interpretation:

- `authenticity_stance` is the coarse community posture and the per-type policies are the authoritative allowlist
- per-type policy is required because `image`, `video`, and `song` have materially different authenticity questions
- authenticity policy is separate from copyright, safety, and source authorization
- a `song_mode = remix` post is not inherently AI-generated; remix status and authenticity status remain separate axes
- community policy may allow AI-generated vocals in the abstract, but platform-level bans on deceptive impersonation or unauthorized synthetic likeness of a real singer still override that community choice

Recommended stance semantics:

- `human_only`
  - community intends human-authored content only
  - AI-assisted or AI-generated categories should normally remain disallowed unless Pirate later defines an explicitly non-generative restoration exception the community enables
- `human_first`
  - community prioritizes human-authored content
  - narrowly scoped AI assistance may be allowed per media-type policy
  - fully AI-generated content should remain disallowed unless the relevant per-type policy explicitly enables it
- `ai_allowed_with_disclosure`
  - community allows the relevant AI-assisted and AI-generated categories defined by the per-type policy
  - any post that qualifies under those categories must disclose that fact at publish time
- `ai_allowed`
  - community allows the relevant AI-assisted and AI-generated categories defined by the per-type policy
  - disclosure is optional unless another product or moderation policy requires it

Default when unset:

- if `content_authenticity_policy` is `null`, the effective policy must resolve to:
  - `authenticity_stance = human_first`
  - text `allow_ai_assisted_editing = false`
  - text `allow_ai_generated = false`
  - image `allow_ai_upscale = false`
  - image `allow_ai_restoration = false`
  - image `allow_generative_editing = false`
  - image `allow_ai_generated = false`
  - video `allow_ai_upscale = false`
  - video `allow_ai_restoration = false`
  - video `allow_ai_frame_interpolation = false`
  - video `allow_generative_editing = false`
  - video `allow_ai_generated = false`
  - song `allow_ai_assisted_mastering = false`
  - song `allow_ai_stem_separation = false`
  - song `allow_ai_generated_instrumentals = false`
  - song `allow_ai_generated_lyrics = false`
  - song `allow_ai_generated_vocals = false`
- this default applies from the first post onward, including communities that become `active` before the owner configures an explicit policy
- post-create onboarding may offer the owner a chance to relax this default, but it is not a prerequisite for `draft -> active`

Recommended v0 examples:

- photography club
  - `authenticity_stance = human_only`
  - image `allow_ai_generated = false`
  - image `allow_generative_editing = false`
  - image `allow_ai_upscale` and `allow_ai_restoration` depend on club preference
- meme or AI-art club
  - `authenticity_stance = ai_allowed_with_disclosure` or `ai_allowed`
  - image and video generative categories may be enabled explicitly
- music-remix club
  - `song_mode = remix` remains allowed per normal posting policy
  - `song_policy` separately decides whether AI-generated vocals, lyrics, or instrumentals are acceptable

## Source Policy

AI authenticity policy does not answer whether a community allows reposts or human-made fan works about real people.

Suggested v0 field:

- `source_policy`

Storage note:

- the stored community setting may be `null` at create time in public v0
- `null` does not mean the community has no source rules
- the server must resolve a restrictive effective default policy whenever no explicit community source policy has been configured yet
- community activation must not be blocked on setting an explicit source policy

Suggested v0 shape:

- `identified_person_media_scope`
  - `subject_only`
  - `subject_or_authorized`
  - `public_source_allowed`
- `require_source_url_for_reposts`
- `allow_human_made_fan_art_of_real_people`
- `require_fan_art_disclosure`

Interpretation:

- `identified_person_media_scope` answers whether the community allows media of identified real people only from the subject, from the subject plus authorized sources, or from public sources more broadly
- `require_source_url_for_reposts` applies to reposted real media and should require the post to preserve a source URL or equivalent attribution pointer when one exists
- `allow_human_made_fan_art_of_real_people` governs ordinary human-created illustration or similar fan works, not synthetic likenesses
- `require_fan_art_disclosure` should add a visible fan-art disclosure when that category is allowed
- platform-banned deceptive synthetic likenesses of real people remain outside this schema

Example:

- a model-focused community may allow reposts from the model's own public accounts with `identified_person_media_scope = subject_only`
- the same community may allow hand-drawn fan art with `allow_human_made_fan_art_of_real_people = true`
- that community still cannot opt into deepfakes or synthetic sexual edits of that person because those remain platform-level prohibitions

Default when unset:

- if `source_policy` is `null`, the effective policy must resolve to:
  - `identified_person_media_scope = subject_only`
  - `require_source_url_for_reposts = true`
  - `allow_human_made_fan_art_of_real_people = false`
  - `require_fan_art_disclosure = false`
- this default applies from the first post onward, including communities that become `active` before the owner configures an explicit policy
- post-create onboarding may offer the owner a chance to relax this default, but it is not a prerequisite for `draft -> active`

## Content Authenticity Detection Policy

Authenticity detection provider choice should remain provider-agnostic and platform-governed.

This policy is separate from:

- `content_authenticity_policy`, which defines what the community allows
- platform-required safety analysis such as `18+`, CSAM, sexual-content, and violence detection

Suggested v0 field:

- `content_authenticity_detection_policy`

Storage note:

- the stored community setting may be `null` at create time in public v0
- if `null`, the server resolves the platform default authenticity-detection profile
- community activation must not be blocked on setting an explicit authenticity-detection policy

Suggested v0 shape:

- `selection_mode`
  - `platform_default`
  - `approved_profile`
- `authenticity_detection_profile_id` nullable

Interpretation:

- `selection_mode = platform_default` means Pirate uses the current platform-managed default authenticity-detection profile for this community
- `selection_mode = approved_profile` means the community selected one specific profile from Pirate's platform-approved registry
- communities should not submit raw provider names, thresholds, or model toggles directly
- Pirate may back different approved profiles with different vendors such as Hive, TruthScan, or a future in-house model without changing community-facing semantics
- provider-specific thresholds and model combinations belong to the platform-managed profile, not to community settings

Recommended v0 platform-owned profile registry shape:

- `authenticity_detection_profile_id`
- `profile_key`
- `provider_key`
- `supported_capabilities`
  - `image_authenticity`
  - `video_authenticity`
  - `audio_authenticity`
  - `deepfake_detection`
- `status`
  - `active`
  - `archived`

Rules:

- communities may choose only from platform-approved authenticity-detection profiles
- communities may not disable platform-required safety analysis by choosing or omitting an authenticity-detection profile
- platform-required `18+`, CSAM, sexual-content, and other safety classification providers remain platform-managed and non-configurable at the community layer
- communities should be allowed to choose how authenticity evidence is gathered for community-optional AI-content decisions, but only above the platform safety floor

Default when unset:

- if `content_authenticity_detection_policy` is `null`, the effective policy must resolve to:
  - `selection_mode = platform_default`
  - the current active platform-default authenticity-detection profile
- the platform-default authenticity-detection profile is an operational invariant and must always exist while community authenticity detection is enabled
- this default applies from the first post onward
- post-create onboarding may offer the owner a chance to switch to another approved profile, but it is not a prerequisite for `draft -> active`

## Creation-Time And Read-Time Resolution

Authenticity and source policy should be deferred from the public v0 create client without becoming undefined at runtime.

Rules:

- public `POST /communities` may omit `content_authenticity_policy` and `source_policy`
- public `POST /communities` may also omit `content_authenticity_detection_policy`
- if omitted, the community may still transition to or remain `active` according to the normal lifecycle rules
- upload enforcement must always evaluate the effective resolved policy, not the raw nullable stored field
- read surfaces should return the resolved effective policy even when no explicit row has been stored yet
- read surfaces should also indicate whether the returned policy is a platform default or an explicitly configured community policy so settings UI can distinguish "default" from "configured"
- when `policy_origin = default`, resolved policy `updated_at` may be synthesized from the governing default source such as the community `created_at`, the active platform-default profile version timestamp, or another server-defined default-policy revision timestamp
- post-create onboarding should surface these policy controls early, but as a non-blocking settings step rather than a lifecycle gate

## Policy Change Semantics

Authenticity and source-policy changes should be prospective by default.

Rules:

- updating `content_authenticity_policy` or `source_policy` applies to new posts and new moderation decisions after the change
- existing posts keep the `analysis_state`, `content_safety_state`, age-gate result, and disclosure snapshot they had when published unless moderators take a new explicit action
- communities should not automatically reclassify all historical posts when policy flips from `human_first` to `ai_allowed` or vice versa
- if Pirate later adds a bulk review tool for policy migrations, that should be modeled as a moderator workflow rather than an implicit side effect of settings updates
