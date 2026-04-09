# Identity Presentation

Status: draft

Related docs:

- [attestations.md](./attestations.md)
- [user.md](./user.md)
- [community.md](./community.md)
- [post.md](./post.md)
- [composer.md](./composer.md)
- [feed.md](./feed.md)

## Purpose

This doc defines how Pirate lets an author choose how a post appears to other users without changing the canonical backend author identity.

It covers:

- identity mode
- disclosed qualifiers
- community policy for optional qualifiers
- the relationship to anonymous scope
- snapshot behavior on the post row

It does not cover:

- the full verification provider model
- future platform-attestation systems such as purchase-count badges
- the full provider registry or schema-mapping layer for external attestation systems
- break-glass deanonymization workflow

## Core Principle

Pirate always knows the real `author_user_id`.

The user-facing presentation layer is made of only 2 primitives:

- `identity_mode`
- optional `disclosed_qualifiers`

That is the whole model.

Pirate should not make normal users reason about a 4-way presentation taxonomy in the composer.

## V0 Scope

V0 identity-derived disclosed qualifiers should come only from [user.md](./user.md) `verification_capabilities` plus a small provider-specific qualifier layer.

That means v0 can support fact-derived qualifiers such as:

- `18+`
- `US National`
- `Unique Human`
- `Male`
- `Female`

And provider-specific qualifiers such as:

- `Palm Scan`
- `Orb Verified`

V0 should not yet model platform-attestation qualifiers such as:

- `100+ songs purchased`
- `collector tier`
- `club member since 2025`

Those belong in [attestations.md](./attestations.md) and can plug into this same qualifier system later.

## Identity Mode

Suggested v0 `identity_mode` values:

- `public`
- `anonymous`

Interpretation:

- `public`
  Render the author's normal public identity
- `anonymous`
  Render the community anonymous label instead of the public identity

Identity-derived qualifiers are attached to anonymous posting, not public-handle posting.

That means:

- a public post renders only the author's normal public identity
- an anonymous post may attach zero or more qualifiers when community policy allows it
- platform-authored content-authenticity disclosures are a separate exception and may appear on public or anonymous posts when required by community policy

This means:

- anonymous with no qualifiers is just anonymous posting
- anonymous with qualifiers is still anonymous posting
No additional top-level presentation modes are needed.

## Anonymous Scope Interaction

Anonymous presentation still uses the existing anonymous scope system from [community.md](./community.md).

Suggested v0 field:

- `anonymous_scope`
  - `community_stable`
  - `thread_stable`
  - `post_ephemeral`
  - `null`

Rules:

- `anonymous_scope` is required when `identity_mode = anonymous`
- `anonymous_scope` must be `null` when `identity_mode = public`
- the community's configured anonymous policy constrains which scopes may be chosen
- `community_stable` remains the recommended v0 default for moderation continuity

Important UI note:

- normal composer UI should usually expose only a simple `Post anonymously` control
- anonymous scope is primarily community policy in v0, not a mainline authoring decision
- if Pirate later exposes scope selection to users, it should appear as an advanced option rather than the default authoring surface

## Qualifier Templates

Disclosed qualifiers should not be freeform user text.

Pirate should define platform-level `qualifier_templates` that specify how a verified fact or provider-specific verification may be disclosed.

Suggested v0 shape:

- `qualifier_template_id`
- `qualifier_kind`
  - `verification_capability`
  - `provider_attestation`
- `capability_key` nullable
  - `unique_human`
  - `age_over_18`
  - `nationality`
  - `gender`
- `capability_value` nullable
  Example: `US` for nationality templates or `M` for gender templates
- `source_provider` nullable
  - `self`
  - `very`
  - `passport`
  - `world`
- `source_field` nullable
  Example: `nationality`, `gender`, `minimumAge`, `palm_scan`
- `display_label`
  Example: `US National`
- `proof_requirements`
  - one or more explicit proof requirement objects
  - example: `{ proof_type: "unique_human", accepted_providers: ["self", "very"] }`
- `sensitivity_level`
  - `low`
  - `high`
- `redundancy_key`
  Semantic key used to suppress qualifiers already implied by community gates

Important distinction:

- fact-first qualifiers are preferred by default
  - `18+`
  - `US National`
  - `Unique Human`
- provider-specific qualifiers are optional
  - `Palm Scan`
  - `Orb Verified`

This means Pirate can usually render the fact rather than the vendor, while still supporting provider-branded qualifiers when communities explicitly want them.

Examples:

- `qlf_unique_human`
  - `display_label = Unique Human`
  - `qualifier_kind = verification_capability`
  - `capability_key = unique_human`
  - `proof_requirements = [{ proof_type: unique_human, accepted_providers: [self, very] }]`
  - `sensitivity_level = low`
- `qlf_age_over_18`
  - `display_label = 18+`
  - `qualifier_kind = verification_capability`
  - `capability_key = age_over_18`
  - `proof_requirements = [{ proof_type: age_over_18, accepted_providers: [self] }]`
  - `sensitivity_level = low`
- `qlf_nationality_us`
  - `display_label = US National`
  - `qualifier_kind = verification_capability`
  - `capability_key = nationality`
  - `capability_value = US`
  - `proof_requirements = [{ proof_type: nationality, accepted_providers: [self] }]`
  - `sensitivity_level = high`
- `qlf_gender_m`
  - `display_label = Male`
  - `qualifier_kind = verification_capability`
  - `capability_key = gender`
  - `capability_value = M`
  - `proof_requirements = [{ proof_type: gender, accepted_providers: [self] }]`
  - `sensitivity_level = high`
- `qlf_very_palm_scan`
  - `display_label = Palm Scan`
  - `qualifier_kind = provider_attestation`
  - `source_provider = very`
  - `source_field = palm_scan`
  - `sensitivity_level = low`

## Qualifier Inventory

The user-facing qualifier picker should not invent a separate source of truth.

Recommended v0 rule:

- `verification_capabilities` in [user.md](./user.md) remains the source of truth for fact-first qualifiers
- the composer receives a computed qualifier inventory derived from:
  - the user's current `verification_capabilities`
  - the user's current eligible provider-backed attestations from [attestations.md](./attestations.md) when relevant
  - platform-level `qualifier_templates`
  - any explicitly supported provider-specific qualifier layer
- community-level allowlists

This means the qualifier inventory is a compositional read model, not a replacement for `verification_capabilities` or `user_attestations`.

Provider-specific note:

- Self supports variable disclosures and can therefore feed fact-first qualifiers such as `18+`, `US National`, `Male`, or `Female`
- Very may feed a provider-specific qualifier such as `Palm Scan`
- zkPass may later feed registered schema-backed provider attestations through the attestation registry defined in [attestations.md](./attestations.md)
- provider-specific qualifiers should be opt-in and secondary to fact-first qualifiers

## Community Policy

Communities should choose from platform-approved qualifiers rather than inventing their own taxonomy.

Suggested v0 fields on community settings:

- `allow_anonymous_identity`
- `allowed_disclosed_qualifiers`
  Array of `qualifier_template_id`
- `allow_qualifiers_on_anonymous_posts`

Rules:

- communities may whitelist only a subset of platform qualifier templates
- communities may not create arbitrary custom qualifiers in v0
- qualifiers already implied by community gates should be suppressed from the picker and not shown as optional add-ons
- if `allow_qualifiers_on_anonymous_posts = false`, anonymous posts may not attach qualifiers

Public v0 create-flow note:

- public v0 community creation may configure `allowed_disclosed_qualifiers` and `allow_qualifiers_on_anonymous_posts` at create time
- those create-time settings are subject to the anonymous-policy constraints defined in [community.md](./community.md), including the public-v0 default of `anonymous_identity_scope = community_stable`
- `post_ephemeral` and qualifier exposure must follow the guardrails from [community.md](./community.md); public v0 create must not expose combinations that violate those constraints

Recommended defaults:

- ordinary community:
  - `allow_anonymous_identity = false`
  - `allowed_disclosed_qualifiers = []`
- anonymous journalism-style community:
  - `allow_anonymous_identity = true`
- `allowed_disclosed_qualifiers = [qlf_age_over_18, qlf_unique_human]`
  - `allow_qualifiers_on_anonymous_posts = true`

Gate-suppression example:

- `/c/america` may require verified US nationality for posting
- that community may still allow other qualifiers such as `18+` or `Unique Human`
- `US National` should be suppressed from the optional qualifier picker because it is already implied by the community gate

## Post Row Snapshot

Disclosed qualifiers should snapshot onto the post row at publish time.

Recommended v0 post field:

- `disclosed_qualifiers_json`

Suggested item shape:

- `qualifier_template_id`
- `rendered_label`
- `qualifier_kind`
  - `verification_capability`
  - `provider_attestation`
  - `content_authenticity`
- `qualifier_source`
  Example: `verification_capabilities` or `content_authenticity_policy`
- `sensitivity_level`
- `redundancy_key`

Example:

```json
[
  {
    "qualifier_template_id": "qlf_age_over_18",
    "rendered_label": "18+",
    "qualifier_kind": "verification_capability",
    "qualifier_source": "verification_capabilities",
    "sensitivity_level": "low",
    "redundancy_key": "age_over_18:true"
  }
]
```

Why snapshot:

- post rendering remains stable even if templates evolve later
- historical posts do not require a complex join path for basic rendering
- expired qualifiers can be handled by policy without rewriting old posts

## Proof Rules

Each identity-derived disclosed qualifier must satisfy the explicit proof requirements defined by its template.

Rules:

- a qualifier may only be selected if the user currently satisfies the underlying capability or provider attestation required by the template's `proof_requirements`
- qualifier disclosure must not lower the underlying community gate requirement
- if a community already requires a stricter proof for posting or anonymous posting, that stricter requirement still applies
- platform-authored `content_authenticity` disclosures do not depend on user proof requirements; they derive from upload analysis plus community policy

Examples:

- `Unique Human` may be disclosed from accepted providers such as `self` or `very`
- anonymous posting should still require the community's anonymous-posting proof requirements
- nationality disclosure should require an accepted nationality proof in v0

## Content-Type Restrictions

Not every post type should allow anonymous identity.

Recommended v0 rule:

- `text`, `image`, `video`, and `link` may use public or anonymous identity according to community policy
- `song` and `live` must use public identity in v0
- identity-derived qualifiers remain anonymous-only in v0
- platform-authored `content_authenticity` disclosures may still appear on public or anonymous posts when required by community policy
- song posts therefore remain ineligible for anonymous identity qualifiers but may still carry authenticity disclosures when relevant

Reason:

- song and live objects require stable public authorship for rights review, payouts, replay handling, guest invites, and Story-linked operations

## Composer Behavior

The composer should treat this as:

1. optional anonymous toggle
2. optional qualifier multi-select, shown only when anonymous posting is active
3. qualifier chips rendered below

Rules:

- the qualifier picker must only show platform-defined qualifiers that the user is eligible to disclose
- qualifiers must render as normalized labels such as `18+`, `US National`, or `Palm Scan`, not raw proof payloads
- the composer must not allow freeform user-authored qualifiers
- the qualifier picker should hide options already implied by community gates
- if the current tab is `song` or `live`, anonymous identity controls should not appear and the qualifier picker should also stay hidden
- platform-authored `content_authenticity` disclosures are not part of the optional qualifier picker; they should be attached automatically when the community policy requires them

## Rendering

Post and feed rendering should use the snapped presentation data.

Examples:

- public post
  - `@saint-pablo`
- anonymous post
  - `anon_mercury-17`
- anonymous post with qualifiers
  - `anon_mercury-17`
  - `18+`
  - `US National`

The exact pill placement belongs to UI/read-model work, but the intended location is adjacent to the author presentation surface rather than hidden in metadata drawers.

## Privacy Guardrails

Disclosed qualifiers can reduce anonymity.

Rules:

- qualifiers should use normalized labels rather than precise sensitive values when possible
- `sensitivity_level = high` qualifiers such as nationality or gender should produce club-admin warnings when enabled
- `post_ephemeral` anonymous scope must not allow high-sensitivity disclosed qualifiers in v0
- communities should be warned that combining anonymous labels with high-sensitivity identity qualifiers can make re-identification easier in small communities
- wallet-score and Passport stamp-backed qualifiers should default to `allow_qualifiers_on_anonymous_posts = false`
- if a club explicitly enables Passport-backed qualifiers on anonymous posts, Pirate should offer only a normalized low-sensitivity subset such as `Verified Human`, `Trusted Wallet`, or `Screened`
- Pirate must not expose exact Passport scores, raw stamp lists, provider-branded stamp names, or score/stamp breakdowns on anonymous posts
- combinatorial re-identification risk from multiple Passport-backed qualifiers on one anonymous post should be treated as higher than the per-stamp sensitivity might suggest
- Passport-backed qualifier templates should default to `sensitivity_level = high` for anonymous-posting review unless a later policy explicitly whitelists a safer normalized label

## Open Questions

- Should Pirate later expose anonymous-scope selection to end users, or keep it purely club-defined?
- Should Pirate later snapshot qualifier expiry state on posts, or keep the simpler "true at publish time" rule?
- When platform attestations are introduced later, should they reuse this same `qualifier_template` model or require a separate attestation-template namespace?
