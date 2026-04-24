# Post

Status: current working spec

Related docs:

- [community.md](./community.md)
- [moderation.md](./moderation.md)
- [namespace.md](./namespace.md)
- [artist-identity.md](./artist-identity.md)
- [handles.md](./handles.md)
- [user.md](./user.md)
- [identity-presentation.md](./identity-presentation.md)
- [asset.md](./asset.md)
- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [karaoke.md](./karaoke.md)
- [donations.md](./donations.md)
- [karma.md](./karma.md)
- [questions.md](./questions.md)
- [localization.md](./localization.md)

## Purpose

This doc defines the universal social post object shown in Pirate feeds and threads.

It covers:

- post identity and lifecycle
- composer types and constraints
- posting eligibility
- viewing eligibility
- media analysis and copyright checks
- content safety and age gating
- when a post may or must attach a rights-bearing asset

## Non-goals

This doc does not define:

- the full asset registration lifecycle
- the full Story Protocol integration surface
- full royalty graph semantics
- detailed moderation policy or ranking formulas
- exact OpenAPI payloads

## Core Principle

Every submission is a post first.

Some posts also create or attach an asset.

That distinction matters because:

- most user activity should remain lightweight social posting
- rights and royalty registration should be explicit, not automatic
- feed and thread behavior should not depend on Story registration success

## Canonical IDs

Posts use opaque app-issued IDs.

Examples:

- `post_id = pst_01...`
- `community_id = gld_01...`
- `asset_id = ast_01...`

## Posting Eligibility

Posting in Pirate requires identity verification in v0.

The exact verification policy belongs in a later identity/onboarding spec, but the product rule is:

- users must satisfy the required verification capability checks before they can publish posts
- posting requires a verified `unique_human` capability from an accepted provider such as `self` or `very`
- anonymous posting also requires a verified `unique_human` capability from an accepted provider such as `self` or `very`
- user-owned agent posting additionally requires a currently valid agent ownership record as defined in [agent-ownership.md](./agent-ownership.md)
- there is no public-v0 exception path that allows unverified users to publish posts
- passing the identity gate is necessary but not always sufficient; community posting policy may impose additional trust-tier and pacing requirements. See [community.md](./community.md).

Examples of why Pirate may require verification:

- anti-bot protection
- age checks
- nationality or jurisdiction checks where product policy requires them

## Viewing Eligibility

Viewing eligibility may be stricter than posting eligibility.

In v0:

- posts classified as `18+` must require verification that the viewer satisfies the `age_over_18` capability from an accepted provider such as `self`
- club or jurisdiction policy may impose stricter viewing rules later, but the minimum v0 gate is age proof for adult content
- if a derivative post references an upstream asset that is already gated `18+`, the derived post must inherit at least that same viewer gate

## V0 Post Shape

Suggested v0 fields:

- `post_id`
- `community_id`
- `author_user_id`
- `authorship_mode`
- `agent_id` nullable
- `agent_ownership_record_id` nullable
- `identity_mode`
- `anonymous_scope` nullable
- `anonymous_label` nullable
- `agent_display_name_snapshot` nullable
- `agent_owner_handle_snapshot` nullable
- `agent_ownership_provider_snapshot` nullable
- `disclosed_qualifiers_json`
- `label_id` nullable
- `post_type`
- `status`
- `song_mode` nullable
- `title` nullable
- `body` nullable
- `caption` nullable
- `link_url` nullable
- `media_refs`
- `creator_relation` nullable
- `promotion_disclosure` nullable
- `source_language`
- `translation_policy`
- `rights_basis`
- `asset_id` nullable
- `parent_post_id` nullable
- `scheduled_for` nullable
- `analysis_state`
- `analysis_result_ref` nullable
- `content_safety_state`
- `age_gate_policy`
- `created_at`
- `updated_at`

Suggested meanings:

- `authorship_mode`
  - `human_direct`
  - `user_agent`
- `identity_mode`
  - `public`
  - `anonymous`
- `anonymous_scope`
  - `community_stable`
  - `thread_stable`
  - `post_ephemeral`
- `post_type`
  - `text`
  - `image`
  - `video`
  - `link`
  - `song`
- `creator_relation`
  - `captured`
  - `created`
  - `subject`
  - `authorized_repost`
  - `fan_work`
  - `found`
- `status`
  - `draft`
  - `published`
  - `hidden`
  - `removed`
  - `deleted`
- `song_mode`
  - `original`
  - `remix`
- `translation_policy`
  - `none`
  - `machine_allowed`
  - `human_only`
  - `hybrid`
- `rights_basis`
  - `none`
  - `original`
  - `derivative`
  - `attribution_only`
- `analysis_state`
  - `pending`
  - `allow`
  - `allow_with_required_reference`
  - `review_required`
  - `blocked`
- `content_safety_state`
  - `pending`
  - `safe`
  - `sensitive`
  - `adult`
- `age_gate_policy`
  - `none`
  - `18_plus`

Notes:

- `label_id` is an optional pointer to a club-defined label definition used for community labeling and filtering; it is not a substitute for canonical post fields such as `post_type`, `song_mode`, `rights_basis`, `analysis_state`, `content_safety_state`, `age_gate_policy`, or monetization state
- `authorship_mode` is the canonical audit field for distinguishing human-direct writes from user-owned agent writes in v0
- `author_user_id` remains the accountable human principal even when `authorship_mode = user_agent`
- `agent_id` and `agent_ownership_record_id` are nullable and apply only when `authorship_mode = user_agent`
- `identity_mode` is the canonical author-presentation choice for the post
- `anonymous_scope` is nullable and applies only when `identity_mode = anonymous`
- `agent_display_name_snapshot`, `agent_owner_handle_snapshot`, and `agent_ownership_provider_snapshot` are lightweight publish-time rendering snapshots for user-agent posts
- when `authorship_mode = user_agent`, `agent_id`, `agent_ownership_record_id`, `agent_display_name_snapshot`, and `agent_owner_handle_snapshot` are required
- `disclosed_qualifiers_json` stores a publish-time snapshot of the verified qualifier labels the author chose to disclose on this post
- `disclosed_qualifiers_json` may also store platform-authored content-authenticity disclosures required by community policy
- `analysis_state = review_required` is reserved for content, safety, rights, or compliance review signals from analysis
- identity-derived disclosed qualifiers should come from [user.md](./user.md) `verification_capabilities` plus explicitly supported provider-specific qualifier templates
- content-authenticity disclosure entries may be platform-authored from upload analysis plus community policy without becoming freeform user-authored fields
- user-owned agent posting should use `authorship_mode` rather than overloading `author_user_id` or creating a second human principal on the post row
- `asset_id` is nullable because not every post becomes a rights-bearing asset
- `media_refs` points to uploaded content blobs stored separately from the post row
- `media_refs` in v0 should be treated as a JSON array of media descriptor objects such as `{ storage_ref, mime_type, size_bytes, content_hash, duration_ms, width, height }`
- `creator_relation` is a structured author claim used by provenance and false-claim-of-ownership enforcement; it is not equivalent to a loose `[OC]` tag
- `promotion_disclosure` is a structured author declaration used when a post is promotional or affiliated and a community requires that disclosure
- song posts require public identity plus audio and lyrics at post-creation time; anonymous song posting is out of scope in v0
- instrumental and vocal stems are optional advanced inputs that may be attached later through async enrichment rather than blocking initial song publication (see karaoke.md for the staged enrichment model)
- cover art, preview clips, and canvas video are not required mainline inputs for the first v2 song-publish slice unless a later spec explicitly promotes them to publish invariants
- `title` is optional on all v0 post types
- `caption` is primarily for media posts and is optional in v0
- `link_url` is the external URL for `link` type posts; it must be non-null when `post_type = link` and null otherwise
- `source_language` is authoritative server-authored language metadata inferred during write-time analysis rather than user-authored input
- `parent_post_id` supports replies or thread attachment without making all posts comments
- `analysis_result_ref` points to a shared media-analysis record that may also be referenced by the attached asset
- `analysis_result_ref` is a foreign key to a shared `media_analysis_results` record that stores copyright analysis, safety analysis, authenticity/source analysis where available, lyrics/transcript analysis where available, and the final upload-outcome decision
- Story publication state is owned by the attached asset when one exists; API read models may derive a post-level Story badge from the asset's `publication_state`
- `age_gate_policy` is the explicit viewer-access rule stored on the post
- stricter upstream age gates must propagate downstream to derivative posts
- charitable donation destination should not be an arbitrary post-level field in v0; when monetized content opts into donation, it should use the community-level donation partner through the monetization layer
- creator donation participation belongs on the listing, not the post row and not the asset row

### Label

Pirate should support one optional community-scoped label per post.

Purpose:

- help communities label conversational lanes such as `Question`, `Announcement`, `Trip Report`, `Gear Review`, `WIP`, or `Release`
- support lightweight filtering inside a community feed
- give communities some self-definition without turning posts into freeform taxonomy objects

Non-goals:

- replacing canonical post facts already modeled elsewhere
- freeform hashtags or user-created tags
- cross-community global label semantics
- ranking boosts tied to label usage

Rules:

- each post may store `label_id` or `null`
- `label_id` must resolve to an active label definition owned by the same `community_id` as the post
- in v0, `label_id` must be `null` when `parent_post_id` is non-null; reply labels are future work
- labels are optional in v0 unless a community later chooses to require one through community settings
- labels are display and filtering metadata, not canonical domain truth
- system-derived facts must not be modeled as labels when Pirate already has a structured field for them

Examples of what should not be labels:

- `Remix` when `song_mode = remix`
- `18+` when `age_gate_policy = 18_plus`
- `Paid` when monetization or listing state already expresses that
- `Original` when `rights_basis = original`

Examples of good labels:

- `Question`
- `Announcement`
- `Review`
- `Theory`
- `Production`
- `Remix Feedback`
- `WIP`

### Presentation Fields

- `authorship_mode`
  - `human_direct`
  - `user_agent`
- `identity_mode`
  - `public`
  - `anonymous`
- `anonymous_scope`
  - `community_stable`
  - `thread_stable`
  - `post_ephemeral`
  - `null`
- `agent_display_name_snapshot` stores the rendered user-agent display name used by feed and thread bylines; it is `null` when `authorship_mode = human_direct`
- `agent_owner_handle_snapshot` stores the rendered global `.pirate` owner handle used by feed and thread bylines; it is `null` when `authorship_mode = human_direct`
- `agent_ownership_provider_snapshot` stores the ownership provider label when Pirate chooses to expose provider-specific agent ownership context; it is `null` when `authorship_mode = human_direct`
- `anonymous_label` stores the derived anonymous label rendered to other users; it is `null` when `identity_mode = public`
- `disclosed_qualifiers_json` stores a snapshot of the disclosed verified qualifiers rendered with the post
- `author_user_id` is always stored on the post row regardless of identity mode

Suggested v0 `disclosed_qualifiers_json` item shape:

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

### Creator Relation

`creator_relation` is the canonical structured claim about the author's relationship to the submitted content.

Recommended v0 values:

- `captured`
  - the author captured the photo or video
- `created`
  - the author created the work such as an illustration, design, or song
- `subject`
  - the author is the subject depicted in the media
- `authorized_repost`
  - the author has permission to repost the work
- `fan_work`
  - the author created fan content about another subject or work
- `found`
  - the author is sharing the content without claiming ownership or authorship

Rules:

- communities may require `creator_relation` through `provenance_policy`
- `creator_relation` should be evaluated alongside `rights_basis`, `source_policy`, and `content_authenticity_policy`; none of those fields alone is a substitute for the others
- false-claim-of-ownership enforcement should compare structured claims against available provenance and authenticity evidence rather than relying on freeform title tags such as `[OC]`

### Promotion Disclosure

Some communities require promotional and affiliation disclosure as part of the post write model rather than burying it in prose rules.

Suggested v0 `promotion_disclosure` shape:

- `is_promotional`
- `affiliation_kind`
  - `self`
  - `brand`
  - `client`
  - `partner`
  - `employer`
  - `other`

Rules:

- `promotion_disclosure` is optional by default but may become required by community `promotion_policy`
- promotion-policy eligibility such as membership-age or participation-ratio checks should reject the write directly when they fail; they should not create a moderation hold item unless another content rule also requires review

### Presentation Eligibility

Anonymous-capable presentation is not valid for every post shape.

Recommended v0 rule:

- `text`, `image`, `video`, and `link` posts may use public or anonymous identity according to community policy
- `song` posts must use public identity in v0
- live anchor posts must use public identity in v0
- user-owned agent posts must use `identity_mode = public` in v0
- identity-derived disclosed qualifiers are only valid on anonymous posts in v0
- platform-authored `content_authenticity` disclosure entries may appear on eligible public or anonymous posts when community policy requires disclosure

Reasoning:

- song posts require stable authorship for rights review, Story publication, and payout routing
- live anchor posts require stable host identity for room authority, guest invitations, replay clearance, and payout release

### Anonymous Presentation Access Boundary

`author_user_id` on anonymously presented posts is privileged data. The following rules enforce the access boundary:

- the public API and standard read models must not return `author_user_id` on posts where `identity_mode = anonymous`
- community moderators and other users must never see `author_user_id` on anonymously presented posts through any normal product surface
- only the privileged resolver path defined in [community.md](./community.md) may map an anonymous post back to `author_user_id`, and only through the audited break-glass workflow
- internal services and background jobs that need `author_user_id` for operational purposes must operate behind the privileged resolver boundary or receive explicit clearance to access the field
- `identity_mode`, `anonymous_label`, and `disclosed_qualifiers_json` are public presentation fields; they are visible in normal API responses

Anonymous post lifecycle is defined in [community.md](./community.md), including handling for community bans, account deletion, policy flips, and re-verification loss.

## Post Types

### Text

Text posts may exist as normal social posts without any attached asset.

Text posts may also opt into asset creation and Story publication when the author intends to treat the text as a rights-bearing work.

Examples:

- lyrics
- poems
- essays
- other original written work

### Image

Image posts may exist as normal social posts without Story publication.

Image posts may opt into asset creation and Story publication if the author wants attribution, licensing, or royalty participation.

### Video

Video posts may exist as normal social posts without Story publication.

Video posts may opt into asset creation and Story publication when:

- the uploader wants royalties
- the uploader wants derivative attribution
- the uploader wants to license the work

### Link

Link posts point to an external URL with optional title and commentary.

Link posts follow the same simple mental model as Reddit link posts: paste a URL, optionally add title and commentary, and post.

Rules:

- `link` posts require at least a URL in v0
- link preview metadata should be derived automatically when available
- link preview is UI presentation, not a required authoring field
- `link` posts may not attach assets or publish to Story in v0
- `link` posts are subject to the same `link_post_policy` enforcement as described in [community.md](./community.md)

### Song

Song posts represent native song uploads inside Pirate.

Rules:

- a song post must attach an asset
- a song post must publish that asset to Story in v0
- canonical song uploads remain subject to the community's `artist_governance_state`

## Post Submodes

Some specialized behaviors should be modeled as submodes of the base post types rather than as additional top-level `post_type` values in v0.

Examples:

- `song_mode`
  - `original`
  - `remix`

Interpretation:

- a remix is a `song` post with `song_mode = remix`

This keeps the base taxonomy small while preserving music-native behavior.

Important v0 boundary:

- livestreams are not a top-level `post_type`
- a livestream is a separate `live_room` object with an associated anchor post
- `anchor_live_room_id` may appear in read models, but it is not a canonical post field; the canonical relationship is `live_room.anchor_post_id`
- after the room ends, the same anchor post should remain the primary replay discovery surface rather than creating a separate replay-only post in v0
- karaoke is not a top-level `post_type`; it is primarily an asset capability on song assets

## Media Ingestion And Analysis

Uploaded media should be stored and analyzed before a publishable post exists.

Recommended v0 flow:

1. user uploads media
2. Pirate stores the blob in a single Filebase/IPFS-style object storage path
3. Pirate records media metadata
4. Pirate runs automated analysis where relevant
5. Pirate produces an upload decision
6. user chooses whether to continue as a social-only post or an asset-bearing post when policy allows it
7. Pirate creates or updates the post draft
8. Pirate decides whether the post can publish, needs user changes, or requires moderation review

Mainline storage rule for v0:

- Pirate should use one mainline storage abstraction for media blobs and related song artifacts in the first pass
- Pirate should not introduce a second persistence rail such as Arweave for the v0 song-publish path

Suggested media metadata captured during ingestion:

- MIME type
- size
- duration when applicable
- dimensions and aspect ratio when applicable
- content hash
- storage reference

Recommended v0 analysis inputs:

- raw media files
- extracted audio where applicable
- OCR or transcript text where applicable
- song lyrics for song uploads when provided

## Async Enrichment

Some post and asset capabilities do not need to be present at post-creation time. They can be enriched asynchronously after the post is published.

### Song Enrichment Path

Recommended v0 model for song posts:

1. **Post-creation requirements**: audio + lyrics required. Stems (instrumental, vocal) and timed lyrics are optional and may be attached later.
2. **Async enrichment options**:
   - instrumental and vocal stems may be uploaded by the creator after publication
   - stems may be derived later via source separation when that capability becomes available
   - timed lyrics may be derived via forced alignment from lyrics text + audio (see karaoke.md)
   - other metadata enrichment (cover art, language tags) may also happen post-publication
3. **Karaoke readiness gating**: the song asset's `karaoke_ready` flag transitions to `true` only when `karaoke_package_ref` is complete (lyrics ref + instrumental ref + vocal ref at minimum). This is a property of the asset, not the post. See karaoke.md.

This model keeps posting lightweight while preserving karaoke and other enrichment as asset capabilities that activate when their prerequisites are met.

## Automated Analysis

Pirate should run both copyright-oriented analysis and safety-oriented analysis before publication.

The shared `media_analysis_results` record is the source of truth for those outputs.

### Pre-Publish Analysis Gate

Recommended v0 posture:

- native media uploads should be evaluated before the post becomes publicly visible
- platform-required safety analysis and community authenticity/source policy evaluation should therefore be part of the publish gate, not an ordinary after-the-fact moderation workflow
- moderation review remains the fallback for ambiguity, provider failure, timeout, later abuse reports, and post-publication policy evolution

Recommended v0 create outcomes:

- `allow`
  - create the post and allow publication
- `allow_with_required_reference`
  - create the draft or pending post row, but require the missing reference or disclosure before publication completes
- `review_required`
  - do not publish the post
  - create or retain a non-published post row and route it into moderation review
- `blocked`
  - do not publish the post
  - Pirate may reject the create outright or persist only an internal failed-attempt/audit record rather than a normal publishable post row

Interpretation:

- the common path for image, video, and song uploads should resolve before public visibility
- this keeps community AI/content rules enforceable at the point of action rather than turning them into cleanup work for moderators
- `review_required` is a hold state, not a successful publication with later moderation cleanup

### Analysis Timing And Failure Posture

Pirate should prefer fast pre-publish analysis, but should not assume every provider finishes instantly.

Recommended v0 rules:

- Pirate should use a bounded pre-publish analysis budget for blocking analysis work
- if required analysis completes inside the budget, Pirate should decide publishability synchronously
- if required analysis does not complete inside the budget for a high-risk or policy-critical category, Pirate should fail closed into `review_required` or equivalent non-published hold state rather than publishing first
- Pirate should not silently fail open for platform-required safety checks
- fail-open behavior, if ever allowed for low-risk community-optional cases, should still avoid public publication unless Pirate can defend the risk posture clearly; v0 should prefer hold/review over publish-first
- link posts may use lighter-weight or deferred analysis because they do not always contain native media, but any later preview-media analysis should still respect the same platform/community policy boundaries

Recommended v0 concerns:

- copyrighted-audio detection
- derivative/reference suggestions
- AI-generated or manipulated media detection where supported
- lyrics and transcript safety classification
- nudity or sexual-content detection for images and video where supported
- finer adult-content subcategory detection such as artistic nudity, explicit nudity, explicit sexual content, or fetish content where supported
- finer graphic-content subcategory detection such as injury-medical, gore, extreme gore, body-horror/disturbing content, or animal harm where supported
- provenance contradictions between declared `creator_relation` and available authenticity or source evidence
- profanity, sexual-content, and other adult-content classification for text and lyrics

### Copyright And Audio Analysis

Pirate should run automated media identification on uploaded audio-bearing media where supported.

ACRCloud is the primary v0 provider.

Recommended v0 scope:

- `song`
- `video`
- any other upload that contains audio where ACRCloud support exists

Purpose of analysis:

- detect known audio matches in any media type (song, video, or other audio-bearing upload)
- identify likely copyrighted audio usage
- help determine whether a post may claim `rights_basis = original`
- suggest upstream assets for derivative linkage (for song posts, the upstream is typically the original track; for video posts, the upstream may be a matched song or other audio content)
- route ambiguous or risky uploads to moderation review

Important:

- automated analysis is a classification and moderation aid
- automated analysis is not final legal proof of ownership or authorization
- safety analysis is also a classification and moderation aid, not a substitute for human review in edge cases

### Provider Boundaries

Pirate should separate platform-required safety providers from community-selectable authenticity-detection profiles.

Rules:

- platform-required safety analysis such as `18+`, sexual-age ambiguity, credible threats, and other narrow platform-floor categories remains platform-managed and is never chosen by the community
- community authenticity-detection choice applies only to authenticity/source evidence used for community-optional AI-content decisions
- communities may choose only among platform-approved authenticity-detection profiles; they must not submit raw provider keys, thresholds, or vendor-specific model switches
- provider choice must not leak directly into product semantics; Pirate should normalize provider outputs before policy evaluation

Suggested v0 normalized `media_analysis_results` authenticity fields:

- `authenticity_detection_profile_id` nullable
- `authenticity_provider_key` nullable
- `authenticity_provider_task_ref` nullable
- `authenticity_signals_json` nullable

Suggested v0 `authenticity_signals_json` item shape:

- `signal_type`
  - `ai_generated`
  - `generative_editing`
  - `deepfake`
  - `synthetic_voice`
  - `synthetic_music`
- `confidence`
- `provider_label`
- `provider_class`
- `media_scope`
  - `image`
  - `video`
  - `audio`

Interpretation:

- `provider_label` and `provider_class` preserve traceability to the underlying vendor output
- `signal_type` is Pirate's normalized semantic layer used for policy lookup
- the full raw provider payload should remain stored as provider evidence referenced by `analysis_result_ref`, not leaked directly into community policy semantics

Suggested v0 normalized `content_safety_signals_json` item shape:

- `signal_type`
  - `suggestive`
  - `artistic_nudity`
  - `explicit_nudity`
  - `explicit_sexual_content`
  - `fetish_content`
  - `injury_medical`
  - `gore`
  - `extreme_gore`
  - `body_horror_disturbing`
  - `animal_harm`
  - `profanity`
  - `slurs`
  - `group_directed_demeaning_language`
  - `targeted_insults`
  - `targeted_harassment`
  - `threatening_language`
  - `self_harm_discussion`
  - `self_harm_encouragement`
  - `criminal_instruction`
  - `criminal_solicitation`
- `confidence`
- `provider_label`
- `provider_class`
- `media_scope`
  - `text`
  - `image`
  - `video`
  - `audio`

Interpretation:

- the coarse `content_safety_state` and `age_gate_policy` remain the platform-owned safety floor
- these finer safety signals enable community adult-content, graphic-content, language, and civility policy decisions without forcing communities to tune raw provider thresholds
- the same normalized signal may be platform-relevant, community-relevant, or both
- `content_safety_signals_json` includes `text` in `media_scope` because profanity, slur, harassment, and threat categories may arise from text or lyrics analysis, whereas `authenticity_signals_json` remains limited to media scopes relevant to authenticity detection

### Authenticity And Source Policy Interpretation

Community authenticity and source policies should feed into the existing `analysis_state` decision, not create a parallel state machine.

Recommended v0 policy interpretation:

- if a community has not explicitly configured `content_authenticity_policy` or `source_policy`, Pirate must evaluate uploads against the restrictive resolved defaults rather than treating the policy as absent
- if a community has not explicitly configured `content_authenticity_detection_policy`, Pirate must evaluate authenticity signals using the resolved platform-default detection profile rather than treating authenticity detection as disabled
- platform-minimum prohibitions such as non-consensual sexual deepfakes, deceptive impersonation of real people, or other banned synthetic-likeness categories should produce `analysis_state = blocked` regardless of community settings
- AI-detection providers and other authenticity signals are moderation inputs, not dispositive truth by themselves
- if authenticity or source signals are ambiguous, Pirate should prefer `review_required` rather than silently allowing publication
- if the community policy disallows the detected AI-assisted, AI-generated, or source category with high confidence, Pirate may set `analysis_state = blocked`
- if the community policy disallows the category but detection confidence or provenance evidence is not strong enough for an automatic block, Pirate should set `analysis_state = review_required`
- if the community policy allows the category, `analysis_state` should remain `allow` unless another rights, safety, or compliance rule blocks publication
- if the community policy allows the category only with disclosure, disclosure should be handled as a publish-time validation requirement and post snapshot concern rather than a new `analysis_state` value
- prospective policy changes should affect only future posts by default; Pirate should not automatically re-evaluate already published posts solely because the community later changed its authenticity or source settings

### Taste, Provenance, And Promotion Policy Interpretation

Community taste and provenance policies should also feed into the existing publish decision rather than introducing a second moderation state machine.

Recommended v0 policy interpretation:

- `capture_edit_policy` should evaluate non-generative edit categories independently from AI/generative policy
- if the same upload triggers both a non-generative edit category and a generative authenticity signal, the generative authenticity decision takes precedence for allow/block purposes
- if a detected edit category is configured as `require_disclosure`, Pirate should require the disclosure before publication completes
- if `adult_content_policy`, `graphic_content_policy`, `language_policy`, or `civility_policy` sets the detected category to `review`, Pirate should normally create a moderation annotation and route the post to the relevant review queue; whether publication is held depends on whether the category is also platform-floor relevant
- if one of those policies sets the detected category to `disallow` with strong evidence, Pirate may set `analysis_state = blocked` for categories the community is allowed to remove at create time
- legal-but-disputed speech categories such as slurs, hate rhetoric, or non-threatening harassment should usually publish with flags or community-review annotations rather than being forced into a platform hold state
- if `provenance_policy.require_creator_relation = true` and the post omits `creator_relation`, the create request should be rejected as invalid before publication
- if the declared `creator_relation` is disallowed by community `provenance_policy`, Pirate should block the write
- if the declared `creator_relation` materially contradicts authenticity or source evidence with high confidence, Pirate may apply the configured false-claim consequence and set `analysis_state = blocked`
- if the contradiction is plausible but not definitive, Pirate should prefer `review_required`
- motion-media policy should not create a new canonical `gif` post type; it should evaluate media descriptors inside existing `image` and `video` posts
- promotion-policy membership-age or participation-ratio failures should reject the write directly as a posting-policy failure rather than a moderation hold
- if a post is promotional and `promotion_policy.require_affiliation_disclosure = true`, Pirate should reject the write when `promotion_disclosure` is absent

Recommended v0 upload outcomes:

- `allow`
  Upload may proceed without required changes.
- `allow_with_flags`
  Upload may proceed and publish, but Pirate records one or more moderation annotations for labeling, ranking, or community review.
- `allow_with_required_reference`
  Upload may proceed only if the user attaches one or more required upstream references.
- `review_required`
  Upload may proceed only after moderation or compliance review.
- `blocked`
  Upload cannot proceed.

Interpretation:

- `allow_with_flags` is not a separate `analysis_state` on the base post row
- flag-only outcomes should live in moderation annotations and review-queue records rather than overloading the base publishability state machine

Recommended v0 policy interpretation:

- if uploaded audio matches a known Pirate or Story-tracked upstream work, Pirate should require derivative attribution rather than allowing an unsupported original claim
- if uploaded audio strongly matches copyrighted material that Pirate cannot lawfully route into a supported derivative flow, Pirate should hard-block the upload
- if analysis is ambiguous, Pirate may warn, require acknowledgements, or route to review rather than silently allowing publication

### Safety And Age-Gating Interpretation

Recommended v0 policy interpretation:

- if lyrics, transcript, image, or video analysis classifies the content as adult, the resulting post must carry `age_gate_policy = 18_plus`
- if the safety analysis is ambiguous, Pirate may route the upload to review rather than defaulting to unrestricted publication
- if an upstream asset is already `18+`, downstream derivative posts must inherit `age_gate_policy = 18_plus`
- if only a portion of an upstream song or video is adult, Pirate should still apply the stricter gate in v0 rather than attempting fine-grained partial-age-gating

#### Content Safety Policy Table

The following table defines the recommended v0 threshold policy mapping analysis signals to `content_safety_state` and `age_gate_policy` decisions by media type. These platform-owned outcomes are the safety floor; finer community policy may still review or disallow subcategories inside the resulting `sensitive` or `adult` classes.

| Media type | Signal | `content_safety_state` | `age_gate_policy` | Notes |
|---|---|---|---|---|
| text / lyrics | no flagged content | `safe` | `none` | Default for clean text |
| text / lyrics | profanity (mild or strong) | `sensitive` | `none` | Profanity alone does not trigger `18_plus`; it surfaces the `sensitive` label |
| text / lyrics | sexual or adult language | `adult` | `18_plus` | Explicit sexual content triggers adult |
| text / lyrics | slurs, group-directed demeaning language, or non-threatening harassment | `sensitive` | `none` | These signals are usually publishable by default and should create moderation annotations for community policy or moderator review rather than a platform hold. |
| text / lyrics | threatening language, unlawful incitement, or criminal instruction | `pending` (escalated to moderation) | `none` | Platform-floor text risk should route to platform review rather than be treated as ordinary community-governed language. |
| image | no flagged content | `safe` | `none` | Default for clean images |
| image | suggestive or partial nudity | `sensitive` | `none` | Non-explicit suggestive content |
| image | explicit nudity / sexual content | `adult` | `18_plus` | Explicit sexual imagery |
| image | violence / gore | `sensitive` or `pending` (escalated) | varies | Mild violence is `sensitive`; severe or ambiguous cases are set to `pending` with `analysis_state = review_required` pending moderator resolution |
| video | no flagged content | `safe` | `none` | Default for clean video |
| video | suggestive or partial nudity | `sensitive` | `none` | Aligned with image policy |
| video | explicit nudity / sexual content | `adult` | `18_plus` | Explicit sexual video |
| video | violence / gore | `sensitive` or `pending` (escalated) | varies | Mild violence is `sensitive`; severe or ambiguous cases are set to `pending` with `analysis_state = review_required` pending moderator resolution |
| audio | no flagged content | `safe` | `none` | Default for clean audio |
| audio | profanity in lyrics or transcript | `sensitive` | `none` | Profanity alone stays at `sensitive` |
| audio | sexual content in lyrics or transcript | `adult` | `18_plus` | Explicit audio sexual content |

Decision rules derived from this table:

- strong language / profanity alone does not trigger `18_plus`; it triggers `sensitive` at most
- non-explicit nudity is `sensitive`, not `adult`; explicit nudity or sexual content is `adult`
- text/lyrics rules and image/video rules should be internally consistent: the same content classified as adult in text would also be adult in image form
- legal-but-disputed speech signals may be stored as moderation annotations without forcing `content_safety_state = pending`
- ambiguous or mixed signals should set `content_safety_state` to `pending` and `analysis_state` to `review_required` rather than defaulting `content_safety_state` to `safe`

Mapping to post fields:

- if no post row exists yet and the outcome is `blocked`, Pirate should not create a publishable post
- if the outcome is `review_required`, Pirate should not create a publicly visible post; any persisted row should remain non-published until review resolves it
- if club posting policy rejects the write due to trust-tier or pacing rules, Pirate should reject the write directly rather than creating a pending moderation item
- trust-tier rejection and pacing rejection should remain distinct failure cases even when both come from club posting policy; clients should be able to tell "not allowed at your current trust level" apart from "quota exhausted for now"
- when a draft post is created from an allowed upload, `analysis_state` should mirror the final non-blocking upload outcome
- the full reasoning and provider payload live on the shared `media_analysis_results` row referenced by `analysis_result_ref`
- `content_safety_state` and `age_gate_policy` should be copied from the final analysis outcome at post creation time and may later be tightened by moderation
- flag-only moderation outcomes should live on separate moderation annotation or queue records rather than mutating the coarse publishability state
- when authenticity disclosure is required by community policy, the publish flow should snapshot the normalized disclosure label onto `disclosed_qualifiers_json` before publication completes

### Publication Merge Rule

Publication requires both decision axes to pass independently.

A post may be published only when all of the following are true:

- `analysis_state` is in {`allow`, `allow_with_required_reference`}
- `content_safety_state` is in {`safe`, `sensitive`, `adult`}

If either axis is in a blocking state, publication is blocked:

- `analysis_state` in {`pending`, `review_required`, `blocked`} blocks publication
- `content_safety_state = pending` blocks publication
- `analysis_state = allow_with_required_reference` allows publication only after the user attaches the required upstream references
- `content_safety_state = sensitive` allows publication but the post should carry any implied labeling or warnings according to product policy
- `content_safety_state = adult` allows publication only when `age_gate_policy = 18_plus`; the published post must then be gated to adult-eligible viewers according to the club and post viewing rules
- moderation annotations or community-review flags do not block publication by themselves unless they also produced a blocking `analysis_state` or `content_safety_state`

This merge rule is the authoritative publishability gate. Individual analysis and safety decisions feed into it but neither axis alone determines publishability.

## Story Publication Rules

Recommended v0 rules:

- `song`
  - Story publication required
- `text`
  - Story publication optional
- `image`
  - Story publication optional
- `video`
  - Story publication optional

Interpretation:

- most posts stay social by default
- Story is used when the uploader wants a rights-bearing asset and royalty behavior
- songs are strict because they are the clearest royalty-bearing content class in v0
- remix behavior is handled as a constrained `song_mode`

## Rights Basis

`rights_basis` captures what kind of claim the author is making about the attached asset or publication flow.

Suggested meanings:

- `none`
  No rights-bearing claim is being made. The post is purely social.
- `original`
  The author claims the work is original and wants it treated as such.
- `derivative`
  The author acknowledges one or more upstream works and wants derivative treatment.
- `attribution_only`
  The author wants explicit attribution or club-defined revenue sharing without Pirate assuming a strong legal copyright position.

`attribution_only` is especially useful for edge cases such as:

- memes
- formats or performance patterns
- other remix-adjacent content where communities may want sharing norms even when legal status is less clean

Constraints:

- `rights_basis = none` is the default for normal social posts
- `rights_basis` may only be non-`none` when `asset_id` is non-null
- `song` posts with `song_mode = remix` must use `rights_basis = derivative`
- other `song` posts may use `rights_basis = original` or `derivative` depending on the upload flow
- `video`, `image`, and `text` posts may use `original`, `derivative`, or `attribution_only` when an asset exists

## Composer Constraints

Recommended v0 composer rules:

- `text`
  - should require at least one of `title` or `body`
- `image`
  - should require at least one image in `media_refs`
  - may include optional `title` and optional `caption`
- `video`
  - should require at least one video in `media_refs`
  - may include optional `title` and optional `caption`
  - may link one or more upstream assets when derivative attribution is intended
  - audio-bearing uploads should run through ACRCloud analysis
  - image and video uploads should run through safety scanning where supported
- `link`
  - should require a URL
  - may include optional `title` and optional commentary body
  - link preview metadata should be derived automatically, not authored manually
  - may not attach assets or publish to Story in v0
- `song`
  - only available where club posting policy allows it
  - canonical artist songs additionally require `artist_governance_state = artist_governed` or `org_governed`
  - must use `identity_mode = public`
  - should require at least one audio-bearing media item
  - should require lyric text at post-creation time
  - instrumental and vocal stems are optional at post-creation time; they may be attached later or derived through async enrichment
  - the song asset's `karaoke_ready` flag depends on `karaoke_package_ref` completeness, not on composer completeness (see karaoke.md)
  - lyrics should run through LLM-assisted safety classification in addition to any audio analysis
  - may include optional `title` and optional `caption`
  - cover art, preview clips, and canvas are secondary artifact concerns and should not block the mainline first v2 song-create path unless later specs say otherwise
- `song_mode = remix`
  - requires one or more upstream asset references
  - requires `rights_basis = derivative`

## Threading Model

V0 threading is post-based.

Rules:

- root feed posts have `parent_post_id = null`
- replies set `parent_post_id` to another post in the same club
- nested replies are allowed in v0
- exact max depth is implementation-defined in v0 and should be enforced at the API/service layer if needed
- ranking and notification behavior are read-model concerns and do not change the underlying post identity model

## Translation

`translation_policy` is a write-time declaration about what kinds of translated renderings Pirate may surface for the post.

Meanings:

- `none`
  No translated renderings should be generated or surfaced by default.
- `machine_allowed`
  Pirate may generate and surface machine translations.
- `human_only`
  Pirate should only surface human-authored translations.
- `hybrid`
  Pirate may surface both machine and human translations.

The canonical source text remains the authored `body` and `caption`.

The actual translated renderings are localized read-model projections and should not be stored inline on the canonical post row.

### Source Language Authority

`source_language` must be server-authored.

Rules:

- Pirate should detect source language during the write and analysis flow
- the detected `source_language` is the authoritative language used for eager translation fanout, same-language sentinel checks, and read-time translation decisions
- client-authored language declarations should not be treated as canonical for translation cache keys or translation gating

### Translation Materialization Strategy

Machine translation is cheap enough that Pirate should not treat translation as a rare manual exception.

Recommended v0 rule:

- when `translation_policy = machine_allowed` or `translation_policy = hybrid`, Pirate may materialize machine translations for a bounded platform-owned target-locale tier either eagerly after write or lazily on first read
- when `translation_policy = none` or `translation_policy = human_only`, Pirate should not generate machine translations
- the target-locale tier must be explicit and bounded rather than "every language"
- locales outside the target-locale tier should be translated lazily on first read and then cached
- the API contract must not depend on whether a translation was prewarmed eagerly or materialized lazily
- eager fanout is therefore an optimization, not a semantic requirement

Recommended initial target-locale tier:

- `en`
- `es`
- `pt-BR`
- `zh-Hans`
- `zh-Hant`
- `ja`
- `ko`
- `fr`
- `de`
- `ar`
- `hi`
- `ru`
- `id`
- `it`
- `tr`

Operational recommendation:

- Pirate may asynchronously prewarm translations for the default tier after post creation
- Pirate may also choose to keep the same tier lazy in v0 if read latency remains acceptable
- non-tier locales should stay lazy by default

### Translation Cache Rules

Pirate should treat the translation cache as production-critical infrastructure, not as an incidental optimization.

Required rules:

- cache translations by `(content_id, locale, source_hash)` rather than by locale alone
- `source_hash` must change when canonical source text changes so edits invalidate translations deterministically
- locale lookup and writes must use normalized locale tags as defined in [localization.md](./localization.md)
- when `source_language` and target language resolve to the same effective language, Pirate should cache a same-language sentinel result instead of repeatedly calling the model
- translation cache reads should reject obviously invalid or corrupted payloads and treat them as cache misses
- corruption guards are required because earlier Pirate translation flows already hit malformed-cache cases in production

### Translation Execution

Pirate should standardize one execution contract for machine translation so provider choice does not leak into product behavior.

Recommended v0 provider stack:

- provider: OpenRouter
- default model: `google/gemini-2.5-flash-lite`
- request mode: non-streaming
- output mode: structured JSON with a strict schema
- request granularity: one target locale per model call

Recommended response schema:

```json
{
  "type": "object",
  "properties": {
    "source_language": {
      "type": "string",
      "description": "Detected source language for the canonical source text"
    },
    "target_locale": {
      "type": "string",
      "description": "Normalized target locale for this translation"
    },
    "outcome": {
      "type": "string",
      "enum": ["translated", "same_language"]
    },
    "translated_body": {
      "type": ["string", "null"],
      "description": "Translated body text when present"
    },
    "translated_caption": {
      "type": ["string", "null"],
      "description": "Translated caption text when present"
    }
  },
  "required": [
    "source_language",
    "target_locale",
    "outcome",
    "translated_body",
    "translated_caption"
  ],
  "additionalProperties": false
}
```

Execution rules:

- use strict schema enforcement so parsing failures and hallucinated fields do not become cache writes
- `outcome = same_language` is the model-level representation of the same-language sentinel
- one locale per request keeps retries, cache writes, and invalidation simple
- Pirate may add a fallback model later, but `google/gemini-2.5-flash-lite` is the default v0 choice

Concurrency rules:

- if Pirate prewarms default-tier translations asynchronously, it should use bounded concurrency rather than faning out unbounded parallel requests
- recommended concurrent requests per post: `4-6`
- lazy non-tier translations should resolve as one request per cache miss

### Localized Read Projection

Post reads should always return a localized view layered around the canonical post object.

Recommended response shape:

- canonical `post`
  - includes `source_language`
- localized envelope fields
  - `resolved_locale`
  - `translation_state`
  - `machine_translated`
  - `translated_body` nullable
  - `translated_caption` nullable
  - `source_hash`

Read-path rules:

- localized read fields should live on the read-model envelope rather than on the canonical post row
- `translation_state`
  - `ready`
  - `pending`
  - `same_language`
  - `policy_blocked`
- `machine_translated = true` only when `translation_state = ready`
- `body` and `caption` remain the canonical original text in the response
- `translated_body` and `translated_caption` are viewer-facing renderings for the resolved locale when available
- if translation has not yet been materialized or policy blocks translation, the read model should fall back to original text with `machine_translated = false`
- `source_hash` is a content fingerprint for translation cache invalidation and may be returned to clients for debugging and local-cache coordination
- clients should always offer one-tap inline `Show original` when translated text is being shown

## Moderation

Post moderation should be modeled separately from the base post row.

Suggested v0 moderation record shape:

- `post_moderation_action_id`
- `post_id`
- `community_id`
- `actor_user_id`
- `action_type`
- `reason_code` nullable
- `notes` nullable
- `created_at`

Suggested `action_type` values:

- `hide`
- `unhide`
- `remove`
- `restore`
- `lock`
- `unlock`

Suggested v0 automated moderation annotation shape:

- `post_moderation_annotation_id`
- `post_id`
- `community_id`
- `source`
  - `platform_analysis`
  - `community_automation`
  - `user_report`
- `signal_type`
- `severity`
- `queue_scope`
  - `platform`
  - `community`
- `evidence_ref` nullable
- `created_at`

Rules:

- `status` on the post stores the current visible lifecycle state
- moderation records store the action history that led to that state
- moderation annotations store classifier-derived or report-derived flags that may not have changed the base post lifecycle yet
- whether a post is publishable remains a function of the base `analysis_state` and `content_safety_state` merge rule rather than a separate boolean on each annotation
- moderators act within community policy; platform admins retain fallback authority
- moderators may tighten `content_safety_state` or `age_gate_policy` after review, but should not weaken inherited upstream age gates without explicit admin tooling

## Votes And Reactions

Posts may receive votes and lightweight reactions from eligible users.

### Eligibility

Rules:

- the voter must have `verification_capabilities.unique_human.state = verified` from an accepted biometric/nullifier provider such as `self` or `very`
- the voter's nullifier must be valid and not duplicated across accounts
- unverified users may view vote counts but their interactions must not produce karma events
- CAPTCHA must not be required for normal verified-user voting
- self-votes must not produce karma events

### Vote Shape

Suggested v0 `post_votes` shape:

- `post_vote_id`
- `post_id`
- `user_id`
- `value`
- `created_at`
- `updated_at`

Suggested meanings:

- `value`
  - `1` (upvote)
  - `-1` (downvote)

Rules:

- one vote per user per post in v0
- unique on `(user_id, post_id)`
- votes are mutable: a user may change their vote from up to down or vice versa
- changing a vote writes a new value on the existing row; it does not create a new vote row
- removing a vote (setting to neutral) is not supported in v0; users may only switch direction
- vote writes should be rate-limited to prevent vote-spam
- vote weight is one user one vote in v0; weighted voting by karma is not part of v0
- votes are app-level records, not onchain objects

### Relationship To Karma

- upvotes received on the author's posts produce `post_upvote_received` karma events for the author
- downvotes received on the author's posts produce `post_downvote_received` karma events for the author
- vote counts are denormalized on the post read model for display performance
- vote counts on the post read model are aggregate projections, not the canonical source of truth

### Reaction Shape

Reactions are lightweight post signals distinct from votes.

Suggested v0 `post_reactions` shape:

- `post_reaction_id`
- `post_id`
- `user_id`
- `reaction_kind`
- `created_at`
- `updated_at`

Suggested `reaction_kind` values:

- `like`

Rules:

- one active reaction per `(user_id, post_id, reaction_kind)` in v0
- unique on `(user_id, post_id, reaction_kind)`
- v0 supports `like` only; additional reaction kinds may be added later without changing the canonical shape
- reactions are mutable through add/remove behavior; removing a reaction deletes or deactivates the user's active reaction row for that kind
- reactions do not produce karma events in v0
- reaction counts are denormalized on the post read model for display performance
- reaction rows are the canonical source of truth for reaction notifications such as the aggregated `reaction` notification defined in [notifications.md](./notifications.md)

### Suggested Interaction Read Fields

Suggested viewer-facing post read-model fields:

- `upvote_count`
- `downvote_count`
- `like_count`
- `viewer_vote` nullable
- `viewer_reaction_kinds`

Rules:

- interaction counts on read models are projections derived from canonical vote and reaction rows
- `viewer_vote` should be `1`, `-1`, or `null`
- `viewer_reaction_kinds` should list the caller's active reaction kinds on the post and should be empty when none are active

## V0 Scope Notes

- reposts, crossposts, and quote-posts are not part of v0
- v0 top-level post types are intentionally narrow:
  - `text`
  - `image`
  - `video`
  - `link`
  - `song`
- remix behavior is modeled as a song submode in v0 rather than a separate top-level post type
- dance is not a distinct v0 post type or submode; videos are just videos and may optionally carry derivative references

## Relationship To Assets

Posts and assets should stay separate in the model.

Rules:

- every asset originates from exactly one post
- not every post has an asset
- a post can reference upstream assets even if it does not create its own asset
- Story publication failure must not corrupt the underlying post object

This is why `post.md` and `asset.md` should stay separate.

`post.md` owns:

- feed behavior
- thread behavior
- post types
- composer constraints
- moderation states

`asset.md` owns:

- storage references
- Story publication lifecycle
- derivative edges
- royalty graph attachment

## API Implications

Likely first endpoints:

- `POST /posts`
- `GET /posts/{post_id}`
- `PATCH /posts/{post_id}`
- `POST /posts/{post_id}/publish`
- `POST /posts/{post_id}/reference-upstream`

## Open Questions

- Should v0 allow later conversion of a purely social post into an asset-bearing post after publication?
- Which post types should be eligible for homepage vertical-feed ranking?
