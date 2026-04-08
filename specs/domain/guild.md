# Guild

Status: draft

Related docs:

- [namespace.md](./namespace.md)
- [artist-identity.md](./artist-identity.md)
- [artist-catalog.md](./artist-catalog.md)
- [handles.md](./handles.md)
- [profile.md](./profile.md)
- [onboarding.md](./onboarding.md)
- [monetization.md](./monetization.md)
- [donations.md](./donations.md)
- [karma.md](./karma.md)
- [questions.md](./questions.md)
- [livestream.md](./livestream.md)
- [karaoke.md](./karaoke.md)

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

`majeur` means Pirate's on-chain DAO governance layer. See a separate governance/contracts spec.

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

- `self_age_over_18`
- `self_nationality`

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

- `self_age_over_18` should use a boolean-style config such as `{ required: true }`
- `self_nationality` should use an explicit policy payload such as `{ operator: "in", country_codes: ["US"] }`
- nationality gates should compare against the stored verified nationality from the accepted Self identity record, not user-entered profile text

### Adult Guilds

Guilds may default to adult-only viewing.

Suggested v0 field:

- `default_age_gate_policy`
  - `none`
  - `18_plus`

Rules:

- if `default_age_gate_policy = 18_plus`, guild viewing requires `self_age_over_18`
- post-level or asset-level age gates may be stricter, but not looser, than the guild default
- adult guilds should still use post and asset safety classification; the guild default is not a substitute for content scanning

### Settings

`settings` is a structured guild configuration object.

V0 settings should stay structured and namespaced rather than becoming an untyped JSON dump.

Suggested v0 settings areas:

- `posting_policy`
- `author_presentation_policy`
- `moderation_policy`
- `safety_policy`

#### Posting Policy

Suggested v0 fields:

- `posting_identity_mode`
  - `public_handle_only`
  - `allow_anonymous`
  - `anonymous_only`
- `anonymous_identity_scope`
  - `guild_stable`
  - `thread_stable`
  - `post_ephemeral`

Recommended defaults:

- `posting_identity_mode = public_handle_only`
- if anonymous posting is enabled, `anonymous_identity_scope = guild_stable`

Rules:

- `public_handle_only` means posts render the author's normal public identity according to profile and handle rules
- `allow_anonymous` means the author chooses per post whether to publish under their normal identity or under the guild's anonymous identity layer
- `anonymous_only` means all member-authored posts in that guild use the anonymous identity layer by default
- anonymous posting hides identity from public users and guild moderators
- anonymous posting does not remove the canonical backend author link; posts still resolve to `author_user_id`
- `guild_stable` is the recommended moderation-safe mode because repeated behavior from the same hidden person remains recognizable inside that guild
- `post_ephemeral` is allowed as a later experiment but is not recommended as the default because it weakens moderation continuity and abuse handling
- `identity_nullifier_hash` from [user.md](./user.md) must never be used to derive anonymous labels; it exists for uniqueness enforcement only

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

### Verified Badge Exposure Guardrails

When `default_author_presentation = anonymous_label_with_verified_badges`, verified attributes such as nationality or age may materially reduce anonymity.

V0 guardrails:

- exposing nationality badges on anonymous posts is a deliberate re-identification tradeoff: in small guilds, the combination of anonymous label plus nationality may point to a single plausible person
- Pirate should warn guild owners when they enable nationality badges on anonymous posts that this materially reduces anonymity, especially in guilds with few active members
- age badges (`18+`) are coarser and carry less re-identification risk; they may remain visible without additional warning
- defining a precise active-member threshold and automated enforcement for nationality badge exposure is future product work; v0 should document the risk and rely on creator awareness rather than hard gating

### Post Ephemeral Safeguards

`post_ephemeral` must not be enabled for a guild without the following prerequisites:

- automated content safety classification must be active for the guild; posts must reach a terminal classification state (`safe`, `sensitive`, or `adult`) before publication — `pending` classification must block publication
- the guild must have at least one active moderator
- the guild must acknowledge in settings that strike accumulation is structurally impossible under this scope and that moderation is limited to per-post removal only
- `post_ephemeral` guilds must not expose verified-author badges on anonymous posts

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

- if a guild changes `posting_identity_mode` from `allow_anonymous` or `anonymous_only` to `public_handle_only`, existing anonymous posts must not be retroactively deanonymized
- existing anonymous posts should retain their anonymous labels and presentation
- new posts after the policy change follow the new identity mode

Reverification loss:

- if a user's `self_verification_state` moves to `reverification_required` or `unverified`, their existing anonymous posts remain visible and retain their anonymous labels
- the user must not be able to create new anonymous posts until verification is restored
- loss of verification does not deanonymize or remove existing anonymous posts

#### Author Presentation Policy

Suggested v0 fields:

- `default_author_presentation`
  - `public_handle`
  - `anonymous_label`
  - `anonymous_label_with_verified_badges`
- `allowed_verified_author_badges`
  - `nationality`
  - `age_over_18`

Rules:

- verified-author badges are a presentation policy, not an access-control rule by themselves
- nationality badges should only be shown from the user's accepted verified Self nationality, never from self-declared profile text
- age badges should be coarse, such as `18+`, not exact age
- guilds may choose to expose neither, one, or both verified badges
- exposed verified badges should be explicit guild policy rather than a global Pirate default

Recommended interpretation:

- a guild such as `/g/american` may gate membership or posting on verified US nationality and also choose to expose a nationality badge on posts
- exposing verified nationality can improve discourse quality, but it materially reduces anonymity in small guilds and should be treated as a deliberate tradeoff

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
3. User supplies:
   - `display_name`
   - `description`
   - namespace label and route family
   - optional artist link
   - `membership_mode`
   - `governance_mode`
   - initial namespace handle policy or handle policy template
   - optional approved donation partner
4. System validates:
   - creator eligibility
   - root ownership proof for the chosen namespace family
   - namespace availability
   - artist identity linkage if provided
   - handle policy validity, including pricing model, reserved labels, and claim-gating rules
5. System creates:
    - guild row
    - namespace row
    - namespace handle policy row
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
- guild creation must require verified control of the corresponding external root
- guild creation must produce a namespace handle policy, even if it starts from a platform template
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
- whether external gates such as NFT/token or Self-based gates must be satisfied before claim
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
- `POST /guilds/{guild_id}/claim-artist`
- `POST /guilds/{guild_id}/attach-governance`
- `POST /guilds/{guild_id}/moderators`
- `GET /guilds/{guild_id}/posts`

## Open Questions

- Should all guild creators require Self verification, or only some guild operations?
- What exact proof set is sufficient to move a guild from `claim_pending` to `artist_governed` or `org_governed`?
- Which governance actions must stay operational and never require DAO voting?
- What is the minimal guild settings surface needed for v0?
- Should the anonymous badge size threshold (`100`) be configurable per guild within platform bounds, or fixed?
- Should `thread_stable` anonymous scope also scope moderation strikes to the thread, or should strikes still accumulate guild-wide?
- What rendering format should anonymous labels use beyond `anon_` prefix — should they be memorable, numeric, or a mix?
