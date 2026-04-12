# Moderation

Status: draft

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [feed.md](./feed.md)
- [notifications.md](./notifications.md)
- [blocks.md](./blocks.md)
- [karma.md](./karma.md)
- [messaging.md](./messaging.md)
- [livestream.md](./livestream.md)

## Purpose

This doc defines Pirate's moderation model.

It covers:

- the division of responsibility between Pirate and communities
- the difference between platform-illegal content and community-governed content
- normalized moderation signals
- moderation outcomes and review queues
- community policy knobs and presets
- moderator tooling expectations

## Non-goals

This doc does not define:

- a complete legal analysis for every jurisdiction
- a complete Trust and Safety operations manual
- exact classifier thresholds for a specific provider
- exact OpenAPI payloads

## Core Principle

Pirate should operate as a community-governed system with a narrow platform floor.

That means:

- Pirate blocks or holds content when Pirate itself must intervene
- communities decide what to do with most legal but disputed content
- classifiers are inputs to policy, not policy by themselves
- moderators need tooling, not constant platform override

This is intentionally closer to the structural role of subreddit moderation than to a centrally curated social feed.

## Moderation Layers

Pirate moderation should have three layers:

1. `platform floor`
2. `community policy`
3. `moderator operations`

### Platform Floor

The platform floor is the set of content categories Pirate handles directly because delegating them entirely to community moderators would be inadequate.

Suggested platform-floor buckets:

- sexual content involving minors
- credible threats of violence
- unlawful incitement or criminal solicitation
- explicit illegal exploitation content
- clearly unlawful image or video cases
- other categories Pirate later decides are too risky to delegate entirely

Recommended platform actions:

- `block`
- `review_required`
- `age_gate_required`

The platform floor should stay narrow.

### Community Policy

Community policy governs content that is legal but socially disputed, offensive, unpleasant, disruptive, or norm-violating.

Suggested community-governed buckets:

- hate and group-directed demeaning language
- slurs
- harassment short of true threats
- ordinary profanity
- lawful adult content
- lawful graphic content
- shock content
- spam and low-effort posting
- community-specific taste rules

Communities may be stricter than Pirate.

Communities should not be looser than the platform floor.

### Moderator Operations

Moderator operations are the day-to-day tools and workflows used to review, remove, label, filter, and escalate content.

This layer should include:

- review queues
- mod notes
- audit trails
- automation rules
- filterable signal views
- user and post history context

## Jurisdiction Baseline

Pirate should describe its platform floor as a legal and operational minimum, not as a general speech policy.

Recommended posture:

- Pirate intervenes where content is illegal under Pirate's governing legal posture or where Pirate has a strong platform-risk reason to intervene
- Pirate does not treat classifier categories such as `hate` or `harassment` as automatic platform violations by themselves
- communities remain responsible for most legal-but-disputed speech norms

This means Pirate should not equate a vendor classifier label with an objective legal conclusion.

## Provider Model

Third-party moderation providers should be treated as signal generators.

They do not define:

- Pirate's legal policy
- Pirate's community-governance model
- Pirate's final moderation decision

They do help with:

- content classification
- queue prioritization
- moderator filtering
- labeling and warnings
- automation inputs for community rules

## Three-Part Signal Model

Pirate should model moderation data in three parts:

1. provider output
2. Pirate-normalized signals
3. policy action

### 1. Provider Output

Store the raw provider result for auditability and later recalibration.

Suggested fields:

- `provider_key`
- `provider_model`
- `provider_label`
- `provider_score`
- `provider_payload_ref`
- `applied_input_types`

### 2. Pirate-Normalized Signals

Pirate should define a stable internal taxonomy that is meaningful to moderators and communities.

Suggested v0 signal types:

- `explicit_sexual_content`
- `explicit_nudity`
- `suggestive_content`
- `fetish_content`
- `graphic_violence`
- `non_graphic_violence`
- `self_harm_discussion`
- `self_harm_encouragement`
- `profanity`
- `slurs`
- `group_directed_demeaning_language`
- `targeted_insults`
- `targeted_harassment`
- `threatening_language`
- `criminal_instruction`
- `criminal_solicitation`

Interpretation:

- this list is the policy-level taxonomy used for moderation design and community controls
- [post.md](./post.md) may use finer-grained schema-level subtypes where that helps product semantics or policy tuning
- for example, `suggestive_content` may map to schema-level signals such as `suggestive` or `artistic_nudity`
- `graphic_violence` and `non_graphic_violence` may map to schema-level signals such as `injury_medical`, `gore`, `extreme_gore`, `body_horror_disturbing`, or `animal_harm`
- the finer-grained post schema is not a contradiction; it is the implementation-facing expansion of this policy-level taxonomy

Suggested signal fields:

- `signal_type`
- `confidence`
- `media_scope`
- `provider_key`
- `provider_label`
- `evidence_ref`
- `is_platform_floor_relevant`
- `is_community_policy_relevant`

### 3. Policy Action

Policy action is what Pirate and the community actually do with the content.

Suggested action set:

- `publish`
- `publish_with_label`
- `publish_with_age_gate`
- `publish_and_flag`
- `publish_with_limited_distribution`
- `review_required`
- `blocked`

Pirate should not collapse all non-clean content into `review_required` or `blocked`.

Legal-but-disputed content often needs to publish while still being visible to moderators.

## Moderation Outcomes

Pirate should separate platform outcomes from community outcomes.

### Platform Outcomes

Suggested v0 platform outcomes:

- `platform_allow`
- `platform_allow_with_age_gate`
- `platform_flag`
- `platform_review_required`
- `platform_blocked`

### Community Outcomes

Suggested v0 community outcomes:

- `community_allow`
- `community_label`
- `community_flag`
- `community_review`
- `community_remove`

This allows Pirate to distinguish:

- content Pirate itself will not host
- content Pirate will host but communities may not want
- content a community allows but wants labeled

## Review Queues

Pirate should keep two distinct queues.

### Platform Review Queue

Use for:

- likely illegal content
- credible threats
- ambiguous sexual-age cases
- high-risk violent or exploitation cases
- provider conflicts on platform-floor categories

Default property:

- non-public or temporarily held while unresolved

### Community Review Queue

Use for:

- legal but norm-violating content
- category matches that a community set to `review`
- posts flagged by users
- posts surfaced by automod rules

Default property:

- may already be public if the community policy uses a `publish_and_flag` style flow

## Community Policy Surface

Community creators should not configure provider labels or raw thresholds directly.

Instead, they should configure Pirate-level policy groups.

Suggested v0 groups:

- adult content
- graphic content
- language and slurs
- harassment and civility
- threats and intimidation
- self-harm discussion
- criminal-instruction content

Suggested action choices for each group:

- `allow`
- `label`
- `review`
- `disallow`

Some groups may intentionally support fewer options.

Examples:

- `threatening_language` should never be community-`allow` without at least platform flagging
- `slurs` may support `allow`, `review`, or `disallow`
- `explicit_sexual_content` may support `allow_with_18_plus`, `review`, or `disallow`

## Community Presets

Most communities will not tune every field manually.

Pirate should offer presets.

Suggested presets:

- `Anything Legal`
  - broad hands-off posture
  - most legal content publishes
  - mods receive flags for sensitive categories
- `General Interest`
  - broad discussion allowed
  - threats and strong harassment queue quickly
  - adult and graphic content labeled
- `Civil Discussion`
  - stricter civility review
  - slurs and targeted harassment queue or remove
- `Adult Creators`
  - explicit adult content allowed with `18_plus`
  - stronger review on age ambiguity
- `No Hate / No Slurs`
  - stricter language and group-directed abuse rules
- `Private High-Trust Club`
  - broader review posture across conduct and quality categories

Presets should map to Pirate policy groups, not to vendor-specific labels.

## Moderator Tooling

If communities own most moderation, moderator tooling becomes a core product surface.

Required capabilities:

- queue by severity and recency
- filter by normalized signal type
- filter by content type
- filter by confidence band
- view provider evidence and explanation
- bulk action support
- reversible actions
- mod notes
- user history context
- audit trail
- optional automod rules

Recommended supporting capabilities:

- saved moderator filters
- escalation from community queue to platform queue
- mute or suppress noisy signal groups
- action analytics for false positives and reversals

## Content-Type Guidance

### Text Posts, Titles, Comments, Link Bodies

Classifier signals should be heavily used here because the text surface is cheap to analyze and central to community governance.

Recommended default handling:

- `hate`, `slurs`, `harassment` style signals usually become `publish_and_flag` or community-controlled review
- `threatening_language` moves to platform review or block depending on confidence and context
- explicit sexual text moves to `18_plus` if Pirate allows it

### Link Posts

Pirate should classify:

- user-entered title
- user-entered body
- fetched preview text where available

Fetched metadata should be advisory evidence rather than an unconditional platform-block input.

### Images

Image moderation should drive:

- adult gating
- graphic warnings
- queue placement

Pirate should not treat a single provider result as definitive proof that sexual imagery is adult-only rather than involving minors.

Ambiguous sexual-age cases should stay in the platform review path.

### Video

Video should follow the same logic as images, with optional transcript-based text classification when available.

### Songs

For songs, Pirate should moderate:

- title
- lyrics
- cover art
- canvas video

Pirate should not rely on a generic moderation endpoint to interpret raw audio meaning.

### Messaging And Live Surfaces

Messaging and live chat should reuse the same normalized taxonomy where possible, but with separate response-time and operational rules.

Private messaging may justify different defaults from public posting, but the normalized signals should remain aligned.

## OpenAI Moderation As A Starting Provider

OpenAI moderation is a reasonable first-pass provider because it is cheap to integrate and broad enough to be useful across text and images.

Pirate should use it as:

- a text and image classifier
- a queue-ranking signal
- a community filter input

Pirate should not use it as:

- the definition of Pirate policy
- proof that a category is illegal
- a complete age-verification system for sexual images

Recommended OpenAI usage in Pirate:

- titles
- text post bodies
- captions
- link-post commentary
- fetched link preview text where available
- lyrics and transcripts
- cover art
- uploaded images
- optional canvas video frames or derived transcript inputs where supported

Not recommended as the sole moderation path for:

- raw audio meaning
- adult-image age certainty
- nuanced community tone decisions

## Default Mapping Guidance

Suggested high-level v0 mapping:

- `explicit sexual content`
  - platform: allow with `18_plus` unless another platform-floor rule applies
  - community: allow, review, or disallow
- `graphic violence`
  - platform: label, review, or hold depending on severity
  - community: allow, review, or disallow
- `slurs`
  - platform: flag
  - community: allow, review, or disallow
- `group_directed_demeaning_language`
  - platform: flag
  - community: allow, review, or disallow
- `targeted_harassment`
  - platform: flag or review depending on severity
  - community: review or disallow
- `threatening_language`
  - platform: review or block
  - community: not the primary decision-maker
- `criminal_instruction`
  - platform: review or block depending on severity and specificity
  - community: secondary

## Relationship To Existing Post State

The current post model already separates:

- `analysis_state`
- `content_safety_state`
- `age_gate_policy`

That shape remains useful, but Pirate should add first-class support for `publish_and_flag` style outcomes.

Recommended direction:

- keep `analysis_state` for publishability and hold/block decisions
- keep `content_safety_state` for coarse feed and viewing behavior
- add a separate moderation-annotation layer for flag-only and label-only outcomes

Pirate should not force all classifier matches into a non-public hold state.

## Relationship To Existing Community Policy

The current policy model for adult, graphic, and language categories is a good foundation.

Recommended evolution:

- keep the structured policy approach
- add civility and threat policy groups
- move most hate and harassment handling out of the platform-only layer and into community policy plus moderator tooling
- reserve platform override for narrow high-risk subsets such as threats or likely illegal content

## Recommended Follow-Up Spec Changes

Suggested next changes across the repo:

1. Expand the normalized safety taxonomy in [post.md](./post.md) beyond adult, graphic, and language categories.
2. Add a dedicated moderation domain or API shape for flag-only outcomes and moderator queue entries.
3. Revise [community.md](./community.md) and community policy schemas so hate and harassment are not treated as automatic platform-policy categories by default.
4. Add community presets and automod semantics to the community policy surface.
5. Distinguish platform review queues from community review queues in notifications and moderation records.

## Bottom Line

Pirate should be a platform with a narrow floor and strong community governance.

The platform decides what Pirate must not host.

Communities decide what kind of legal discourse they want.

Moderation providers classify.

Pirate normalizes.

Policies decide.

Moderators govern.
