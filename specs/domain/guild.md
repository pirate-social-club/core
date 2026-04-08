# Guild

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

A `guild` is the canonical social container for:

- posting
- moderation
- membership
- ranking
- karma within that guild
- livestream and karaoke eligibility
- governance attachment

A guild is not:

- a route
- a TLD
- a DAO
- an artist identity
- a subreddit

## Non-goals

This doc does not define:

- the full post model
- the full asset / royalty graph model
- full namespace / routing semantics
- full governance contract details
- external reputation import mechanics beyond how they relate to guilds

## Canonical IDs

Guilds use opaque app-issued IDs, not sequential public integers and not route-derived IDs.

Examples:

- `guild_id = gld_01...`
- `artist_identity_id = art_01...`

The API and specs should use opaque IDs only. Hidden numeric DB keys are allowed as implementation detail but are not canonical product IDs.

## Core State

V0 fields for `guilds`:

- `guild_id`
- `display_name`
- `description`
- `status`
- `artist_identity_id` nullable
- `artist_governance_state`
- `membership_mode`
- `default_age_gate_policy`
- `guild_agent_user_id` nullable
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
- A generic guild can have `artist_identity_id = null`.
- The raw MusicBrainz MBID lives on the artist identity record, not directly on the guild row.
- `guild_agent_user_id` points to the app-level system actor allowed to publish guild-agent content such as daily questions in v0.
- `donation_partner_id` points to the guild's approved donation beneficiary when donation sidecars are enabled.
- `donation_partner_status` describes whether the guild's attachment to that partner is currently usable for new donation-enabled listings.
- Namespace rows point to guilds. See [namespace.md](./namespace.md) for the canonical namespace model.
- `created_by_user_id` assumes Pirate has a stable internal `user_id`; linked wallets or external accounts are separate attachments.
- `settings` is nullable in v0 and defaults to an empty object when omitted at creation time.

## Artist Linkage

Some guilds are linked to a known artist. That linkage is optional.

Rules:

- `guild.artist_identity_id` points to `artist_identities.artist_identity_id`
- `musicbrainz_artist_mbid` is optional but first-class when known
- a guild should not store MBID as its primary artist identifier
- this leaves room for multiple external IDs later without changing guild identity

See [artist-identity.md](./artist-identity.md).

## Why Guild Is Durable

`guild_id` is the canonical product object because:

- names can change
- TLD bindings can change
- governance can upgrade from creator control to multisig to Majeur
- artist governance participation can change
- route structures can change

If posts and membership attach directly to a route, TLD, or DAO address, those upgrades become migrations. Attaching them to `guild_id` keeps the social object stable while names and governance evolve.

This does not imply Cloudflare Durable Objects. It means a durable application identity.

## State Machine

### Guild Lifecycle

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

- `fan_run`: guild is about an artist, but the artist is not verified as participating in governance
- `claim_pending`: a claim exists that the artist or authorized org should participate in governance, but it is unresolved
- `artist_governed`: the artist is verified and actually participates in guild governance
- `org_governed`: a verified organization acting on behalf of the artist participates in guild governance
- non-artist guilds default to `artist_governance_state = fan_run` in v0

### Governance Mode

- `centralized`
- `multisig`
- `majeur`

These are separate from lifecycle and artist governance state. Do not combine them into one mega-state machine.

Recommended product labels:

- `centralized` = `Creator-led`
- `multisig` = `Multisig`
- `majeur` = `Majeur DAO`

See [governance-backends.md](./governance-backends.md) for the shared attachment model, [multisig-attachment.md](./multisig-attachment.md) for Safe-style multisig attachment, and [majeur-creation.md](./majeur-creation.md) for the advanced Majeur-backed creation flow.

### Donation Policy Mode

- `none`
- `optional_creator_sidecar`
- `fundraiser_default`

Recommended meanings:

- `none`: the guild has no active charitable donation policy
- `optional_creator_sidecar`: monetized creator content may opt to donate some creator-side proceeds to the guild's configured donation partner
- `fundraiser_default`: later fundraiser-first flows may use the guild donation configuration as a primary default

See [donations.md](./donations.md).

Validation rules:

- if `donation_policy_mode = none`, then `donation_partner_id = null` and `donation_partner_status = unconfigured`
- if `donation_policy_mode != none`, then `donation_partner_id` must be non-null
- if `donation_policy_mode = optional_creator_sidecar`, then `donation_partner_status = active`
- if `donation_policy_mode = fundraiser_default`, then a partner must still be configured and active before fundraiser-default money flows are allowed

### Membership Mode

- `open`
- `request`
- `gated`

Recommended meanings:

- `open`: anyone can join and participate subject to post policy
- `request`: membership requires moderator approval
- `gated`: membership requires satisfying one or more explicit gate rules

### Membership State Read Model

Guild read models should expose the viewer's membership relationship to the guild.

Suggested v0 `membership_state` values:

- `not_member`
- `pending_request`
- `member`
- `banned`

Rules:

- `membership_state` is a read-model field, not necessarily a canonical guild-row field
- `membership_state = pending_request` means the viewer has an active unresolved membership request for the guild
- guild reads should not force clients to infer pending-request state only from the last `join` mutation result

### Membership Requests

`request` guilds need an explicit admission workflow object.

Suggested v0 `guild_membership_requests` fields:

- `membership_request_id`
- `guild_id`
- `applicant_user_id`
- `status`
- `note` nullable
- `reviewed_by_user_id` nullable
- `review_reason` nullable
- `created_at`
- `updated_at`
- `resolved_at` nullable
- `expires_at`

Suggested `status` values:

- `pending`
- `approved`
- `rejected`
- `canceled`
- `expired`

Rules:

- only `membership_mode = request` guilds create membership requests
- at most one active `pending` membership request may exist per `(guild_id, applicant_user_id)` at a time
- approving a request creates or activates guild membership and resolves the request to `approved`
- rejecting a request does not create membership
- `review_reason` is required when rejecting a membership request
- `review_reason` is optional when approving a membership request
- applicant cancellation resolves the request to `canceled`
- automatic timeout resolves the request to `expired`
- the default request-expiry window should be 30 days unless guild policy later overrides it
- `/leave` applies only to active members; it must not be reused as a way to cancel a pending membership request
- applicants need a dedicated self-service read surface such as `GET /guilds/{guild_id}/membership-requests/mine`
- auto-expired requests should remain visible in moderator and applicant history views with `status = expired`
- auto-expiry should not generate moderator-facing notifications by default because it is low-signal operational noise

### Admission Workflow

Recommended v0 flow:

1. Viewer invokes the guild join action
2. If `membership_mode = open`, membership is created immediately
3. If `membership_mode = request`, a `guild_membership_request` row is created with `status = pending`
4. If `membership_mode = gated`, authoritative membership-scope gate rules are evaluated
5. Moderators or admins review pending requests
6. Approval creates membership and resolves the request
7. Rejection resolves the request without creating membership

Rules:

- the public join action should return enough information for clients to distinguish `joined` from `requested`
- when the result is `requested`, the response should include `membership_request_id`
- moderator review actions must target `membership_request_id`, not a loose `(guild_id, user_id)` pair
- request-mode guilds may still enforce `viewer` and `posting` gates independently of the admission workflow

### Admission Notification Hooks

Membership-request workflow must integrate with the app notification system defined in [notifications.md](./notifications.md).

Required v0 notification hooks:

- when a membership request is created, responsible moderators or admins receive `membership_request_received`
- when a membership request is approved, the applicant receives `membership_request_approved`
- when a membership request is rejected, the applicant receives `membership_request_rejected`

Rules:

- notification creation is server-side only
- these notifications are derived from the membership-request source-of-truth object
- admission notifications must use `membership_request_id` as the target entity reference

## Guild Gates

Guild gates are a guild feature and should be modeled on the guild, not in a separate spec.

Gates may apply to three scopes:

- `membership`
- `viewer`
- `posting`

Suggested v0 gate rule shape:

- `gate_rule_id`
- `guild_id`
- `scope`
- `gate_family`
- `gate_type`
- `minimum_assurance_level` nullable
- `chain_namespace` nullable
- `gate_config`
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `scope`
  - `membership`
  - `viewer`
  - `posting`
- `gate_family`
  - `token_holding`
  - `identity_proof`
- `minimum_assurance_level`
  - `basic`
  - `strong`
  - nullable means use the default for the gate type; see Identity-proof gate config guidance
- `status`
  - `active`
  - `disabled`

Suggested v0 gate types:

Token-holding gates:

- `erc721_holding`
- `erc1155_holding`
- `erc20_balance`
- `solana_nft_holding`

Identity-proof gates:

- `unique_human`
- `age_over_18`
- `nationality`

Rules:

- if `membership_mode = open`, `membership`-scope gate rules have no effect
- if `membership_mode = gated`, active `membership`-scope gate rules become authoritative
- `request` guilds may still use `viewer` and `posting` gates even when membership itself is moderator-approved
- gate evaluation should happen at action time, not only at page load
- page-load gate checks may be cached for UX only; authoritative checks happen on join, view, and post actions
- token gates and identity-proof gates have different evaluation backends and should not be treated as interchangeable in implementation

Chain namespace expectations:

- `erc721_holding`, `erc1155_holding`, and `erc20_balance` use `chain_namespace = eip155`
- `solana_nft_holding` uses `chain_namespace = solana`
- identity-proof gates use `chain_namespace = null`

Implementation note:

- token gates require onchain reads or indexed chain data at evaluation time
- identity-proof gates require Pirate-side verification record lookups at evaluation time
- if a user lacks a wallet attachment for the required `chain_namespace`, the gate evaluation fails

Identity-proof gate config guidance:

- `minimum_assurance_level` is a top-level field on the gate rule, not a value inside `gate_config`
- `unique_human` defaults to `minimum_assurance_level = basic`; set to `strong` for trust-sensitive gates such as anonymous posting
- `age_over_18` defaults to `minimum_assurance_level = strong` and should use a boolean-style config such as `{ required: true }`
- `nationality` defaults to `minimum_assurance_level = strong` and should use an explicit policy payload such as `{ operator: "in", country_codes: ["US"] }`
- nationality gates should compare against `verification_capabilities.nationality.value` from the accepted identity record, not user-entered profile text
- gate evaluation checks `verification_capabilities` on the user row, not the raw provider session; the capability model is the provider-neutral interface

### Adult Guilds

Guilds may default to adult-only viewing.

Suggested v0 field:

- `default_age_gate_policy`
  - `none`
  - `18_plus`

Rules:

- if `default_age_gate_policy = 18_plus`, guild viewing requires `age_over_18` capability with `minimum_assurance_level = strong`
- creating a guild with `default_age_gate_policy = 18_plus` requires the acting creator to satisfy `age_over_18` capability with `minimum_assurance_level = strong`
- updating an existing guild from `default_age_gate_policy = none` to `default_age_gate_policy = 18_plus` requires the acting owner/admin to satisfy `age_over_18` capability with `minimum_assurance_level = strong`
- post-level or asset-level age gates may be stricter, but not looser, than the guild default
- adult guilds should still use post and asset safety classification; the guild default is not a substitute for content scanning

### Settings

`settings` is a structured guild configuration object.

V0 settings should stay structured and namespaced rather than becoming an untyped JSON dump.

Suggested v0 settings areas:

- `community_profile`
- `posting_policy`
- `flair_policy`
- `presentation_policy`
- `moderation_policy`
- `safety_policy`

#### Community Profile

Guilds should have a lightweight community bootstrap surface similar to what users expect from subreddit setup.

Purpose:

- establish day-one community identity and norms
- make the guild understandable to new members without requiring deep browsing
- seed the same practical affordances that tend to work on Reddit: rules, resource links, and optional flair lanes

Suggested v0 settings shape:

- `rules`
  - ordered array of community rules
- `resource_links`
  - ordered array of community resource links

Suggested community rule fields:

- `rule_id`
- `title`
- `body`
- `position`
- `status`

Suggested resource link fields:

- `resource_link_id`
- `label`
- `url`
- `resource_kind`
- `position`
- `status`

Suggested meanings:

- `status`
  - `active`
  - `archived`
- `resource_kind`
  - `link`
  - `playlist`
  - `document`
  - `discord`
  - `website`
  - `other`

Recommended defaults:

- new guilds may start with empty `rules` and empty `resource_links`
- Pirate may offer starter templates for common guild archetypes, but creators should be able to skip them

Rules:

- community profile data is guild-authored presentation and onboarding metadata, not a substitute for enforcement logic stored elsewhere
- rules should be short, readable, and appropriate for sidebar, about-page, or join-surface rendering
- resource links should point to stable, high-signal references such as FAQs, playlists, docs, discords, or external sites
- archived rules and resource links may remain visible in audit or historical admin views but should not appear in normal public rendering
- hard deletion may be deferred in v0; archive-first behavior is preferred for admin safety
- community profile content should usually be defined during guild creation or first-run setup, but must remain editable later by authorized guild admins

#### Flair Policy

Guilds may define a constrained flair system for community-specific conversational lanes.

Suggested v0 settings shape:

- `flair_enabled`
  - `true`
  - `false`
- `require_flair_on_top_level_posts`
  - `true`
  - `false`
- `definitions`
  - ordered array of flair definitions

Suggested flair definition fields:

- `flair_id`
- `label`
- `description` nullable
- `color_token` nullable
- `status`
- `position`
- `allowed_post_types` nullable

Suggested meanings:

- `status`
  - `active`
  - `archived`
- `color_token`
  - design-token reference such as `flair.blue` or equivalent app-owned token key
  - not a raw hex string in v0
- `allowed_post_types`
  - nullable means usable on any top-level post type
  - otherwise a bounded subset of `text`, `image`, `video`, `song`
- `position`
  - zero-indexed integer used for display ordering
  - ties should be broken by `flair_id` ascending for deterministic reads

Recommended defaults:

- `flair_enabled = false` for generic new guilds in v0
- `require_flair_on_top_level_posts = false`
- Pirate may offer starter flair packs for common guild archetypes such as music, hiking, or general discussion

Rules:

- `flair_enabled = false` and `require_flair_on_top_level_posts = true` is an invalid configuration; settings mutation must reject it, or authoritative reads must coerce `require_flair_on_top_level_posts` to `false`
- flair definitions are guild-scoped and have no canonical meaning outside that guild
- guilds should prefer a short, curated list rather than a long taxonomy
- `label` should be human-readable and short enough to render on feed cards and thread headers
- `label` and `description` are guild-authored single-language strings in v0; Pirate does not provide built-in localization for flair definitions yet
- archived flair definitions may remain attached to historical posts but must not be assignable to new posts
- hard deletion of flair definitions is not supported in v0; archival is the only supported removal path so historical posts never lose referential meaning
- if `require_flair_on_top_level_posts = true`, replies should still default to no flair unless a later thread-specific policy says otherwise
- `allowed_post_types` is optional in v0; if omitted, the flair may be used on any eligible top-level post
- if `require_flair_on_top_level_posts = true`, the guild must always have at least one active flair definition
- if `require_flair_on_top_level_posts = true`, the guild must always have at least one active flair definition applicable to each post type it allows members to publish
- archiving the last active required flair, or the last active flair applicable to an allowed post type, must be blocked unless the guild first disables required flair or adds a replacement definition
- guilds must not use flair definitions to duplicate structured product states already modeled elsewhere

Recommended default music flair pack:

- `Discussion`
- `Question`
- `Release`
- `Review`
- `Theory`
- `Gear`
- `Production`
- `Remix Feedback`
- `WIP`
- `Announcement`

#### Posting Policy

`posting_policy` is the guild-local anti-spam and pacing layer.

It should consume:

- posting eligibility gates from [user.md](./user.md) and guild gate evaluation
- `platform_reputation` from [karma.md](./karma.md) as a platform trust floor
- guild-local `trust_tier` from [karma.md](./karma.md) as the main local trust signal

It should not:

- mint karma
- change `platform_reputation`
- allow trust earned in another guild to count as local guild trust

Suggested v0 fields:

- `anonymous_identity_scope`
  - `guild_stable`
  - `thread_stable`
  - `post_ephemeral`
- `platform_reputation_floor`
  - `new`
  - `normal`
  - `trusted`
- `root_post_min_trust_tier`
  - `new`
  - `established`
  - `trusted`
  - `high_trust`
- `reply_min_trust_tier`
  - `new`
  - `established`
  - `trusted`
  - `high_trust`
- `anonymous_posting_min_trust_tier`
  - `new`
  - `established`
  - `trusted`
  - `high_trust`
- `root_post_quota_by_trust_tier`
  - `new`
    - `window_hours`
    - `max_root_posts`
    - `max_song_posts`
    - `max_video_posts`
  - `established`
    - `window_hours`
    - `max_root_posts`
    - `max_song_posts`
    - `max_video_posts`
  - `trusted`
    - `window_hours`
    - `max_root_posts`
    - `max_song_posts`
    - `max_video_posts`
  - `high_trust`
    - `window_hours`
    - `max_root_posts`
    - `max_song_posts`
    - `max_video_posts`
- `reply_quota_by_trust_tier`
  - `new`
    - `window_hours`
    - `max_replies`
    - `burst_window_minutes`
    - `max_replies_per_burst`
  - `established`
    - `window_hours`
    - `max_replies`
    - `burst_window_minutes`
    - `max_replies_per_burst`
  - `trusted`
    - `window_hours`
    - `max_replies`
    - `burst_window_minutes`
    - `max_replies_per_burst`
  - `high_trust`
    - `window_hours`
    - `max_replies`
    - `burst_window_minutes`
    - `max_replies_per_burst`
- `probation_window_days`
- `link_post_policy`
  - `allow`
  - `require_established`

Recommended defaults:

- if anonymous posting is enabled, `anonymous_identity_scope = guild_stable`
- `platform_reputation_floor = new`
- `root_post_min_trust_tier = new`
- `reply_min_trust_tier = new`
- `anonymous_posting_min_trust_tier = established`
- `root_post_quota_by_trust_tier =`
  - `new = { window_hours: 24, max_root_posts: 1, max_song_posts: 0, max_video_posts: 1 }`
  - `established = { window_hours: 24, max_root_posts: 2, max_song_posts: 1, max_video_posts: 1 }`
  - `trusted = { window_hours: 24, max_root_posts: 4, max_song_posts: 1, max_video_posts: 2 }`
  - `high_trust = { window_hours: 24, max_root_posts: 6, max_song_posts: 2, max_video_posts: 3 }`
- `reply_quota_by_trust_tier =`
  - `new = { window_hours: 24, max_replies: 30, burst_window_minutes: 10, max_replies_per_burst: 5 }`
  - `established = { window_hours: 24, max_replies: 60, burst_window_minutes: 10, max_replies_per_burst: 10 }`
  - `trusted = { window_hours: 24, max_replies: 120, burst_window_minutes: 10, max_replies_per_burst: 20 }`
  - `high_trust = { window_hours: 24, max_replies: 240, burst_window_minutes: 10, max_replies_per_burst: 30 }`
- `probation_window_days = 14`
- `link_post_policy = require_established`

Rules:

- `allow_anonymous_identity = false` means posts always render the author's normal public identity according to profile and handle rules
- `allow_anonymous_identity = true` means the author may choose anonymous identity on eligible post types according to guild policy
- anonymous posting hides identity from public users and guild moderators
- anonymous posting does not remove the canonical backend author link; posts still resolve to `author_user_id`
- anonymous posts still use `anonymous_identity_scope` for label derivation and moderation continuity
- `guild_stable` is the recommended moderation-safe mode because repeated behavior from the same hidden person remains recognizable inside that guild
- `post_ephemeral` is allowed as a later experiment but is not recommended as the default because it weakens moderation continuity and abuse handling
- `identity_nullifier_hash` from [user.md](./user.md) must never be used to derive anonymous labels; it exists for uniqueness enforcement only
- the guild-level posting policy is evaluated only after the user has already satisfied the required posting gate checks
- `platform_reputation_floor` is a coarse site-wide safety floor; a user below the floor may not publish in the guild even if they are otherwise verified
- `root_post_min_trust_tier` applies only to top-level feed posts where `parent_post_id = null`
- `reply_min_trust_tier` applies only to replies where `parent_post_id` is non-null
- `anonymous_posting_min_trust_tier` must never be lower than `root_post_min_trust_tier`; `established` is the recommended minimum for anonymous posting in v0
- `probation_window_days` is scoped to the guild and should be interpreted from guild join time or first successful guild activity, according to implementation choice
- a user who is high trust elsewhere is still probationary in a new guild until they satisfy that guild's local quota and karma progression
- a user who is demoted or receives a guild strike re-enters probationary treatment even if their original join-time probation window has elapsed
- `root_post_quota_by_trust_tier` is the primary anti-flood control for new threads
- `max_root_posts` limits all top-level posts regardless of type
- `max_song_posts` and `max_video_posts` are stricter subcaps inside the same root-post window; they do not grant extra posts beyond `max_root_posts`
- the recommended defaults intentionally treat songs as scarce; for most users, publishing 3 to 5 songs in one day should be considered excessive in v0
- `reply_quota_by_trust_tier` should be materially looser than root-post quotas because conversation is healthier than thread flooding, but replies still need a burst cap to suppress spam runs
- raw posting volume and raw reply volume may influence pacing and rate limits under this policy but must not produce karma events
- `link_post_policy = require_established` means link-bearing top-level posts require at least `trust_tier = established` in the guild and should be rejected before publication when the author is below that tier
- trust and rate-limit failures should reject post creation or publication directly; they should not create a moderation queue item by default in v0
- trust-tier failures and quota failures should be distinguishable at the API/error layer
- trust-tier failures should communicate that the requested action is not available at the author's current guild trust level
- quota failures should communicate that the requested action is temporarily unavailable until the relevant window resets
- the platform-managed `guild_agent_user_id` is exempt from ordinary member trust-tier minima and posting quotas in v0 when publishing system-tagged guild content
- this exemption applies only to platform-managed product actors such as daily-question posting, not to arbitrary third-party agents or ordinary member accounts
- trust earned in another guild must not satisfy this guild's local `trust_tier` requirements; cross-guild history may inform `platform_reputation`, but not guild-local posting unlocks

Recommended enforcement order:

1. Evaluate posting eligibility and guild posting gates.
2. Evaluate `platform_reputation_floor`.
3. Evaluate guild-local `trust_tier` and probation status.
4. Determine whether the attempted write is a root post or a reply.
5. Apply the appropriate trust-tier thresholds and quotas for that write type.
6. Reject the write if trust or pacing rules fail.
7. If trust and pacing pass, continue to content analysis and ordinary publish flow.

### Anonymous Subject Derivation

The anonymous identity rendered in the UI is an opaque label derived from a keyed HMAC over `user_id` and scoping context. The `user_id` is not exposed as a raw identifier, and the label is not derivable without `k_anon`.

Derivation rules:

- `guild_stable`: `HMAC(k_anon, user_id || guild_id)`
  - Produces one stable anonymous label per user per guild
  - Same user in the same guild always renders the same anonymous identity
  - Different guilds produce different labels for the same user; cross-guild correlation is not possible from the label alone
- `thread_stable`: `HMAC(k_anon, user_id || guild_id || root_thread_post_id)`
  - Produces one stable anonymous label per user per thread within a guild
  - The same user posting in different threads in the same guild gets different anonymous labels
  - Replies within the same thread share the same label, preserving conversation continuity
- `post_ephemeral`: random opaque label per post
  - Every post receives a fresh unrelated label
  - No accumulation of behavioral history is possible across posts
  - Strike accumulation against a stable subject is structurally impossible under this scope

Implementation notes:

- `k_anon` is a platform-managed secret key stored in a tightly controlled secrets infrastructure, not in the application DB
- the raw HMAC output before encoding is the `anonymous_subject_id`; it is the stable internal identifier used for moderation, strikes, bans, and the privileged resolver
- the `anonymous_subject_id` is encoded as a human-readable anonymous label such as `anon_7f3a` for rendering; the rendered label is a presentation artifact, not the resolution target
- the derivation is deterministic: given the same inputs, the same `anonymous_subject_id` is always produced for `guild_stable` and `thread_stable`
- the derivation is not reversible: knowing the `anonymous_subject_id` or rendered label does not reveal `user_id` without access to `k_anon` and a privileged resolver
- `root_thread_post_id` for `thread_stable` is the top-level post in the thread; all replies in that thread share the same root
- rendered labels are not guaranteed globally unique; two different `anonymous_subject_id` values may produce the same short rendered label — all moderation and resolution must operate against the `anonymous_subject_id`, never the rendered label alone

### Privileged Resolver And Access Boundary

The anonymous derivation is intentionally one-way from the application layer's perspective.

Resolver rules:

- the application API and normal DB query paths must not expose `author_user_id` on anonymous posts to guild moderators, other users, or any non-privileged code path
- `author_user_id` on anonymous posts must be stored in the same post row but access must be gated at the API and read-model layer so that only the privileged resolver path can return it
- the privileged resolver is an internal service boundary, not a DB query
- access to the privileged resolver requires operator-level authentication and produces an auditable deanonymization event
- the privileged resolver may accept an `anonymous_subject_id` plus guild context and return the corresponding `user_id`, but only through the break-glass workflow defined below
- no other service, endpoint, or read model should join anonymous posts back to user identity

This means that even internal services and background jobs must treat anonymous `author_user_id` as privileged data unless they operate behind the resolver boundary.

### Deanonymization Audit

Suggested v0 deanonymization audit record shape:

- `deanonymization_audit_id`
- `operator_user_id`
- `target_anonymous_subject_id`
- `target_scope`
- `target_guild_id`
- `target_thread_root_post_id` nullable
- `target_post_id` nullable
- `target_anonymous_label_rendered` nullable
- `resolved_user_id`
- `reason_code`
- `justification_text`
- `created_at`

Notes:

- `target_anonymous_subject_id` is the stable internal identifier that uniquely identifies the anonymous subject being resolved; it is the primary audit target
- `target_scope`, `target_guild_id`, `target_thread_root_post_id`, and `target_post_id` together reconstruct the resolver input and provide context for audit review
- `target_anonymous_label_rendered` is secondary metadata showing what the label looked like to moderators and users at the time of resolution; it is not used as a resolution target

Suggested `target_scope` values:

- `guild_stable`
- `thread_stable`
- `post_ephemeral`

Suggested `reason_code` values:

- `abuse_investigation`
- `safety_investigation`
- `legal_compliance`
- `dispute_resolution`
- `account_recovery`

Rules:

- every deanonymization event must create a record before the resolver returns the real identity
- the operator must supply a `reason_code` and `justification_text` at invocation time
- the audit log must be append-only and immutable
- audit records must be reviewable by a separate operator or compliance role
- no automated system may invoke the privileged resolver without producing an audit record
- bulk deanonymization is prohibited; each invocation must target a specific `anonymous_subject_id` or post

### Qualifier Exposure Guardrails

When a guild enables disclosed qualifiers on anonymous posts, verified attributes such as nationality or age may materially reduce anonymity.

V0 guardrails:

- exposing high-sensitivity qualifiers such as nationality on anonymous posts is a deliberate re-identification tradeoff: in small guilds, the combination of anonymous label plus nationality may point to a single plausible person
- Pirate should warn guild owners when they enable high-sensitivity disclosed qualifiers on anonymous posts, especially in guilds with few active members
- low-sensitivity qualifiers such as `18+` are coarser and carry less re-identification risk
- qualifier sensitivity should come from platform-defined qualifier templates rather than arbitrary guild judgment
- defining a precise active-member threshold and automated enforcement for high-sensitivity anonymous qualifiers is future product work; v0 should document the risk and rely on creator awareness rather than hard gating

### Post Ephemeral Safeguards

`post_ephemeral` must not be enabled for a guild without the following prerequisites:

- automated content safety classification must be active for the guild; posts must reach a terminal classification state (`safe`, `sensitive`, or `adult`) before publication — `pending` classification must block publication
- the guild must have at least one active moderator
- the guild must acknowledge in settings that strike accumulation is structurally impossible under this scope and that moderation is limited to per-post removal only
- `post_ephemeral` guilds must not expose disclosed qualifiers on anonymous posts in v0

Rules:

- guilds that enable `post_ephemeral` and later disable it should switch to `guild_stable` or `thread_stable`; existing ephemeral labels are not retroactively unified
- `post_ephemeral` must not be the default `anonymous_identity_scope` for any v0 template

### Anonymous Lifecycle Rules

Guild ban:

- when a user is banned from a guild, their `anonymous_subject_id` in that guild should be marked as banned in the same way their real membership is revoked
- the ban attaches to two layers: the `anonymous_subject_id` (the internal resolution target) and `user_id`; both remain hidden from moderators
- moderators act against the moderator-visible rendered label, which the system maps to the `anonymous_subject_id` for enforcement; the rendered label is for readability only and must not be used as the ban or strike target by itself
- banned users must not be able to create new anonymous posts in that guild even through re-verification

Account deletion:

- when a user deletes their account, their anonymous posts should be orphaned or deleted according to the same policy applied to their non-anonymous posts
- orphaned anonymous posts should render as `anon_[deleted]` or equivalent, not as the user's real identity
- the anonymous label derivation must not produce a collision with a new user after account deletion

Policy flip from anonymous to non-anonymous:

- if a guild changes `allow_anonymous_identity` from `true` to `false`, existing anonymous posts must not be retroactively deanonymized
- existing anonymous posts should retain their anonymous labels and presentation
- new posts after the policy change follow the new identity mode

Reverification loss:

- if a user's `verification_state` moves to `reverification_required` or `unverified`, their existing anonymous posts remain visible and retain their anonymous labels
- the user must not be able to create new anonymous posts until verification is restored
- loss of verification does not deanonymize or remove existing anonymous posts

#### Presentation Policy

Suggested v0 fields:

- `allow_anonymous_identity`
- `allowed_disclosed_qualifiers`
  Array of platform-defined `qualifier_template_id`
- `allow_qualifiers_on_anonymous_posts`

Rules:

- disclosed qualifiers are a presentation policy, not an access-control rule by themselves
- guilds may whitelist only a subset of platform-defined disclosed qualifiers
- v0 disclosed qualifiers should come only from [user.md](./user.md) `verification_capabilities` plus explicitly supported provider-specific qualifier templates
- nationality qualifiers should only be shown from `verification_capabilities.nationality.value`, never from self-declared profile text
- age qualifiers should be coarse, such as `18+`, not exact age
- a guild may allow anonymous identity but still choose not to allow disclosed qualifiers on anonymous posts
- qualifiers already implied by guild gates should be suppressed from the optional picker
- song posts and live anchor posts must still obey the stricter public-identity rules defined in [post.md](./post.md) and [composer.md](./composer.md)

Recommended interpretation:

- a guild such as `/g/american` may gate membership or posting on verified US nationality; in that case `US National` should normally be suppressed from the optional qualifier picker because it is already implied by the gate
- anonymous identity and disclosed qualifiers are orthogonal in configuration, but disclosed qualifiers only attach to anonymous posts in v0
- an anonymous post may also attach qualifiers when `allow_qualifiers_on_anonymous_posts = true`

#### Moderation Policy

Suggested v0 fields:

- `strike_policy_enabled`
- `max_strikes`
- `strike_window_days` nullable
- `auto_ban_on_threshold`
- `strike_scope`
  - `guild`
- `platform_escalation_enabled`

Recommended defaults for anonymous guilds:

- `strike_policy_enabled = true`
- `max_strikes = 3`
- `strike_window_days = null`
- `auto_ban_on_threshold = true`
- `strike_scope = guild`
- `platform_escalation_enabled = true`

Rules:

- strikes should attach to the `anonymous_subject_id` behind the post, not to the rendered anonymous label; the rendered label may collide with other subjects and is a presentation artifact only
- guild moderators may issue strikes, removals, mutes, and bans against the `anonymous_subject_id` without learning the real account identity; the moderator UI presents the rendered label for readability but targets the internal subject for enforcement
- a guild-level strike threshold may automatically revoke posting eligibility in that guild
- repeated serious abuse across guilds may escalate to site-level enforcement by Pirate operators

#### Operator Deanonymization Policy

Suggested v0 fields:

- `moderator_identity_visibility`
  - `hidden`
- `operator_identity_visibility`
  - `break_glass_only`
- `operator_deanonymization_audit_required`

Rules:

- guild moderators should not be able to reveal the real account behind an anonymous post
- Pirate site operators may reveal the real account only through the privileged resolver defined in the Privileged Resolver And Access Boundary section above
- every operator deanonymization event must create a deanonymization audit record before the resolver returns the real identity; see the Deanonymization Audit section for the required record shape
- operator deanonymization is for abuse, dispute, safety, legal, or recovery handling; it is not routine moderation workflow
- the privileged resolver is an internal service boundary that operators access through authenticated tooling, not through direct DB access or standard API endpoints
- `author_user_id` on anonymous posts must not be readable through standard API or read-model paths regardless of the caller's role

This gives Pirate a strong user-facing anonymous mode while preserving real enforcement authority at the platform layer through a controlled, auditable boundary.

## Permissions

Core actor roles:

- `platform_admin`
- `guild_owner`
- `moderator`
- `verified_artist_delegate`
- `member`
- `non_member`

Core actions:

- `edit_guild_profile`
- `manage_flair_definitions`
- `change_namespace_binding`
- `change_membership_rules`
- `grant_moderator`
- `remove_moderator`
- `freeze_guild`
- `create_post`
- `create_song_post`
- `create_trivia`
- `schedule_ama`
- `schedule_livestream`
- `attach_governance`
- `upgrade_artist_governance_state`
- `configure_donation_policy`

Recommended default principles:

- the creator becomes the initial `guild_owner` at creation time
- `guild_owner` is the durable controlling abstraction
- `moderator` manages operational guild state, not treasury policy
- `verified_artist_delegate` unlocks artist-specific actions like native song uploads and official AMAs
- `platform_admin` is fallback / dispute / recovery authority only

For anonymous guilds, `platform_admin` should be understood as Pirate site-operator authority rather than ordinary guild moderation authority.

### V0 Permissions Matrix

| Action | platform_admin | guild_owner | moderator | verified_artist_delegate | member |
|---|---|---|---|---|---|
| `edit_guild_profile` | yes | yes | no | no | no |
| `manage_flair_definitions` | yes | yes | no | no | no |
| `change_membership_rules` | yes | yes | no | no | no |
| `change_namespace_binding` | yes | no | no | no | no |
| `grant_moderator` | yes | yes | no | no | no |
| `remove_moderator` | yes | yes | no | no | no |
| `freeze_guild` | yes | yes | no | no | no |
| `create_post` | yes | yes | yes | yes | yes |
| `create_song_post` | yes | yes | no | yes | no |
| `create_trivia` | yes | yes | yes | yes | no |
| `schedule_ama` | yes | yes | no | yes | no |
| `schedule_livestream` | yes | yes | no | yes | no |
| `attach_governance` | yes | yes | no | no | no |
| `upgrade_artist_governance_state` | yes | yes | no | yes | no |
| `configure_donation_policy` | yes | yes | no | no | no |

Notes:

- `member` assumes the membership and post policies allow the action.
- `manage_flair_definitions` may be implemented under the same settings surface as `edit_guild_profile` in v0, but it is called out separately so flair ownership is explicit.
- `attach_governance` means binding or upgrading from `centralized` to `multisig` or `majeur`, or updating the concrete governance reference inside the chosen mode.
- `change_namespace_binding` is an admin-only recovery action in v0. Canonical label changes, aliases, and redirects are out of scope for v0 namespace semantics.
- admin-only deanonymization for anonymous guilds should be modeled as internal operator tooling and audit policy, not as a normal moderator-visible guild permission.
- donation policy changes should be audit-logged because they change money-routing behavior.

## Artist Verification And Governance

For artist-linked guilds, verification means that the artist, or an authorized organization acting on the artist's behalf, is actually involved in guild governance.

This replaces the older vague concept of an "official" stamp.

The source of truth for verification evidence is a separate proof record set, not a single field on the guild row.

Suggested v0 proof record shape:

- `proof_id`
- `guild_id`
- `subject_type`
- `proof_type`
- `proof_target`
- `status`
- `verified_at` nullable
- `evidence_ref`
- `created_at`

Suggested meanings:

- `subject_type`
  - `artist`
  - `org`
- `proof_type`
  - `wallet_signature`
  - `instagram_bio`
  - `x_bio_or_post`
  - `dns_txt`
  - `website_file_or_meta`
  - `manual_review`
- `proof_target`
  The identifier being proven, e.g. Instagram handle, X handle, or domain name.
- `status`
  - `pending`
  - `accepted`
  - `rejected`
  - `revoked`
- `evidence_ref`
  A pointer to stored verification evidence in Pirate-controlled storage, such as a captured payload, screenshot artifact, or review record.

The guild stores the derived current state:

- `artist_governance_state`

The proof records store the evidence history that justifies it.

Canonical song uploads require:

- `artist_governance_state = artist_governed`
- or `artist_governance_state = org_governed`

`fan_run` and `claim_pending` guilds cannot upload canonical songs for the artist as native song posts.

## Guild Reference Links

Guilds may carry external reference links that help users understand, verify, or enrich the guild without making those links part of core identity.

Suggested v0 shape:

- `guild_reference_link_id`
- `guild_id`
- `platform`
- `url`
- `external_id` nullable
- `label` nullable
- `verification_state`
- `metadata` nullable
- `created_at`
- `updated_at`

Uniqueness rules:

- unique on `(guild_id, platform, external_id)` when `external_id` is not null
- otherwise unique on `(guild_id, platform, url)`

Examples of `platform`:

- `musicbrainz`
- `genius`
- `spotify`
- `apple_music`
- `wikipedia`
- `instagram`
- `x`
- `official_website`

`verification_state` values in v0:

- `unverified`
- `pending_review`
- `verified`
- `rejected`

`metadata` is nullable in v0 and defaults to an empty object when omitted. V0 defines no required metadata keys.

Reference links are supplemental:

- `artist_identity_id` remains the canonical structured artist linkage
- reference links provide context, discovery, and possible review inputs
- not every reference link is proof of authority

## Create Guild Flow

Happy-path v0:

1. Authenticated user starts guild creation.
2. User passes required identity verification policy.
   - for root-attached guild creation in v0, this means `verification_capabilities.unique_human.state = verified` with `assurance_level = strong`
   - because only `self` satisfies `unique_human` at `strong` assurance in v0, Self verification is the default creator-verification path
   - if the new guild sets `default_age_gate_policy = 18_plus`, the creator must also satisfy `verification_capabilities.age_over_18.state = verified` with `assurance_level = strong`
3. User supplies:
   - `display_name`
   - `description`
   - namespace label and route family
   - optional artist link
   - `membership_mode`
   - `governance_mode`
   - optional anonymous posting settings:
     - `allow_anonymous_identity`
     - optional `anonymous_identity_scope` when anonymous posting is enabled
   - optional qualifier policy:
     - optional `allowed_disclosed_qualifiers`
     - optional `allow_qualifiers_on_anonymous_posts`
   - initial namespace handle policy or handle policy template
   - optional initial community bootstrap:
     - flair policy and initial flair definitions
     - community rules
     - resource links
   - optional approved donation partner
4. System validates:
   - creator eligibility
   - root control proof for the chosen namespace family
   - namespace availability
   - artist identity linkage if provided
   - handle policy validity, including pricing model, reserved labels, and claim-gating rules
5. System creates:
    - guild row
    - namespace row
    - namespace handle policy row
    - initial community profile settings
    - default moderation policy
    - default post policy
    - default karma policy

Canonical karma policy is defined in [karma.md](./karma.md).

Donation defaults at creation:

- `donation_policy_mode = none`
- `donation_partner_id = null`
- `donation_partner_status = unconfigured`

If the creator supplies an approved donation partner at creation time, Pirate may instead initialize:

- `donation_policy_mode = optional_creator_sidecar`
- `donation_partner_id` set
- `donation_partner_status = active`

6. System optionally attaches:
   - artist claim request
   - artist metadata enrichment job
   - resolver delegation
   - multisig
   - Majeur DAO
7. Guild becomes `active`.

Important:

- guild creation must not require a DAO
- guild creation must require a namespace choice
- guild creation must require creator verification at `unique_human = strong`
- guild creation must additionally require creator verification at `age_over_18 = strong` whenever `default_age_gate_policy = 18_plus`
- guild creation must require verified control of the corresponding external root
- guild creation must produce a namespace handle policy, even if it starts from a platform template
- guild creation may also capture community bootstrap settings so the guild launches with flair, rules, and resource links already defined
- artist linkage must be optional

## Namespace Handle Policy At Creation

Namespace-handle economics should be explicit from the start.

At guild creation, the creator should choose one of:

- a platform-defined handle policy template
- an explicit custom namespace-handle policy

Recommended v0 templates:

- `standard`
- `premium`
- `membership_gated`
- `custom`

The chosen policy should define or derive:

- minimum open claim length
- premium length threshold
- pricing model
- reserved labels
- whether guild membership is required before claim
- whether external gates such as NFT/token or identity-proof gates must be satisfied before claim
- whether generated name suggestions are available and what ontology they use

Examples:

- an artist guild may choose `premium`
  - short names expensive
  - labels like `king` individually reserved and listed
- a token-gated guild such as Pudgy Penguins may choose `membership_gated`
  - NFT gate first
  - then cheap or free names inside the guild

The detailed namespace-handle model lives in [handles.md](./handles.md).

Artist-linked guilds may also trigger catalog bootstrap and question-generation source enrichment.
See [artist-catalog.md](./artist-catalog.md) and [questions.md](./questions.md).

## Relationship To Posts

Every post belongs to exactly one guild.

That gives the app one stable boundary for:

- moderation
- ranking
- membership gating
- karma
- feed assembly
- live and karaoke policy

An asset created from a post may later have wider monetization or discovery, but the originating social context is still the guild.

## Relationship To Governance

`guild_id` and DAO identity are different layers.

- `guild_id` is the canonical product object
- a Majeur DAO is one possible governance backend attached later

Recommended progression:

1. creator-controlled guild
2. optional multisig attachment
3. optional Majeur DAO attachment

Do not require DAO execution for routine moderation actions.

See [governance-backends.md](./governance-backends.md) for the operational-versus-constitutional authority split.

## Relationship To Namespace

Namespace owns the canonical route syntax. Guild owns the social object.

Summary:

- every guild has one namespace row at creation in v0
- namespace rows point to guilds
- route families and handle syntax are defined in [namespace.md](./namespace.md)
- changes to resolver proof or root ownership must not create a new `guild_id`

## External Platforms

Guilds should not be defined by old external guilds like subreddits.

For v0:

- do not model a new guild as a pointer to an old subreddit
- do not make subreddit linkage part of guild identity

External platforms are better handled as optional onboarding/profile trust imports, not as the core identity of the guild itself.

## External Reputation And Trust

External reputation should not become native Pirate karma.

Recommended distinction:

- `Pirate karma` = earned on Pirate
- `external reputation` = onboarding-time verified trust context from other platforms

Reddit-specific trust examples that may be shown on user profiles:

- verified Reddit username
- subreddit-specific karma such as `/r/kanye`
- account age
- moderator status, if verifiable

Recommended v0 approach:

- optional onboarding step
- user proves control of Reddit account, e.g. profile-code proof
- Pirate captures a one-time reputation snapshot
- snapshot is displayed on profile as trust context

This is useful for bootstrapping trust, but it should stay on the user/profile side, not the guild identity side, and it should not imply a full ongoing sync system.

Canonical onboarding flow details for this live in [onboarding.md](./onboarding.md).

Guild-local karma is defined in [karma.md](./karma.md).

## On-chain vs Off-chain

Recommended v0 split:

- app DB is the initial source of truth for guild existence and settings
- on-chain attachments are optional and incremental

Possible later contracts:

- `GuildRegistryV1`
- `GuildFactoryV1`
- `GuildGovernanceAdapterV1`

But guild existence itself should not require immediate on-chain creation unless there is a very strong product reason.

## API Implications

Likely first endpoints:

- `POST /guilds`
- `GET /guilds/{guild_id}`
- `PATCH /guilds/{guild_id}`
- `POST /guilds/{guild_id}/join`
- `POST /guilds/{guild_id}/leave`
- `GET /guilds/{guild_id}/membership-requests`
- `GET /guilds/{guild_id}/membership-requests/mine`
- `POST /guilds/{guild_id}/membership-requests/{id}/approve`
- `POST /guilds/{guild_id}/membership-requests/{id}/reject`
- `POST /guilds/{guild_id}/membership-requests/{id}/cancel`
- `GET /guilds/{guild_id}/flairs`
- `PATCH /guilds/{guild_id}/flairs`
- `GET /guilds/{guild_id}/community-profile`
- `PATCH /guilds/{guild_id}/community-profile`
- `POST /guilds/{guild_id}/claim-artist`
- `POST /guilds/{guild_id}/attach-governance`
- `POST /guilds/{guild_id}/moderators`
- `GET /guilds/{guild_id}/posts`

## Open Questions

- What exact proof set is sufficient to move a guild from `claim_pending` to `artist_governed` or `org_governed`?
- Which governance actions must stay operational and never require DAO voting?
- What is the minimal guild settings surface needed for v0?
- Should the anonymous badge size threshold (`100`) be configurable per guild within platform bounds, or fixed?
- Should `thread_stable` anonymous scope also scope moderation strikes to the thread, or should strikes still accumulate guild-wide?
- What rendering format should anonymous labels use beyond `anon_` prefix — should they be memorable, numeric, or a mix?
