# Post

Status: draft

Related docs:

- [guild.md](./guild.md)
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
- `guild_id = gld_01...`
- `asset_id = ast_01...`

## Posting Eligibility

Posting in Pirate requires identity verification in v0.

The exact verification policy belongs in a later identity/onboarding spec, but the product rule is:

- users must satisfy the required verification capability checks before they can publish posts
- the minimum verification for posting is `unique_human` capability at `basic` assurance or higher
- passing the identity gate is necessary but not always sufficient; guild posting policy may impose additional trust-tier and pacing requirements. See [guild.md](./guild.md) under Posting Policy.

Examples of why Pirate may require verification:

- anti-bot protection
- age checks
- nationality or jurisdiction checks where product policy requires them

## Viewing Eligibility

Viewing eligibility may be stricter than posting eligibility.

In v0:

- posts classified as `18+` must require verification that the viewer satisfies the `age_over_18` capability at `strong` assurance
- guild or jurisdiction policy may impose stricter viewing rules later, but the minimum v0 gate is age proof for adult content
- if a derivative post references an upstream asset that is already gated `18+`, the derived post must inherit at least that same viewer gate

## V0 Post Shape

Suggested v0 fields:

- `post_id`
- `guild_id`
- `author_user_id`
- `identity_mode`
- `anonymous_scope` nullable
- `anonymous_label` nullable
- `disclosed_qualifiers_json`
- `flair_id` nullable
- `post_type`
- `status`
- `song_mode` nullable
- `title` nullable
- `body` nullable
- `caption` nullable
- `media_refs`
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

- `identity_mode`
  - `public`
  - `anonymous`
- `anonymous_scope`
  - `guild_stable`
  - `thread_stable`
  - `post_ephemeral`
- `post_type`
  - `text`
  - `image`
  - `video`
  - `song`
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
- `content_safety_state`
  - `pending`
  - `safe`
  - `sensitive`
  - `adult`
- `age_gate_policy`
  - `none`
  - `18_plus`

Notes:

- `flair_id` is an optional pointer to a guild-defined flair definition used for community labeling and filtering; it is not a substitute for canonical post fields such as `post_type`, `song_mode`, `rights_basis`, `analysis_state`, `content_safety_state`, `age_gate_policy`, or monetization state
- `identity_mode` is the canonical author-presentation choice for the post
- `anonymous_scope` is nullable and applies only when `identity_mode = anonymous`
- `disclosed_qualifiers_json` stores a publish-time snapshot of the verified qualifier labels the author chose to disclose on this post
- `analysis_state = review_required` is reserved for content, safety, rights, or compliance review signals from analysis
- v0 disclosed qualifiers should come from [user.md](./user.md) `verification_capabilities` plus explicitly supported provider-specific qualifier templates
- v0 canonical posts do not distinguish human-initiated writes from agent-initiated writes on the base row; if Pirate later supports user-owned agents posting on behalf of a user, a field such as `submission_mode` or `authorship_mode` should be added as the auditability extension point rather than overloading `author_user_id`
- `asset_id` is nullable because not every post becomes a rights-bearing asset
- `media_refs` points to uploaded content blobs stored separately from the post row
- `media_refs` in v0 should be treated as a JSON array of media descriptor objects such as `{ storage_ref, mime_type, size_bytes, content_hash, duration_ms, width, height }`
- song posts require audio and lyrics at post-creation time; instrumental and vocal stems are optional advanced inputs that may also be attached or derived later through async enrichment (see karaoke.md for the staged enrichment model)
- `title` is optional on all v0 post types
- `caption` is primarily for media posts and is optional in v0
- `source_language` is authoritative server-authored language metadata inferred during write-time analysis rather than user-authored input
- `parent_post_id` supports replies or thread attachment without making all posts comments
- `analysis_result_ref` points to a shared media-analysis record that may also be referenced by the attached asset
- `analysis_result_ref` is a foreign key to a shared `media_analysis_results` record that stores copyright analysis, safety analysis, lyrics/transcript analysis where available, and the final upload-outcome decision
- Story publication state is owned by the attached asset when one exists; API read models may derive a post-level Story badge from the asset's `publication_state`
- `age_gate_policy` is the explicit viewer-access rule stored on the post
- stricter upstream age gates must propagate downstream to derivative posts
- charitable donation destination should not be an arbitrary post-level field in v0; when monetized content opts into donation, it should use the guild-level donation partner through the monetization layer
- creator donation participation belongs on the listing, not the post row and not the asset row

### Flair

Pirate should support one optional guild-scoped flair per post.

Purpose:

- help communities label conversational lanes such as `Question`, `Announcement`, `Trip Report`, `Gear Review`, `WIP`, or `Release`
- support lightweight filtering inside a guild feed
- give guilds some self-definition without turning posts into freeform taxonomy objects

Non-goals:

- replacing canonical post facts already modeled elsewhere
- freeform hashtags or user-created tags
- cross-guild global flair semantics
- ranking boosts tied to flair usage

Rules:

- each post may store `flair_id` or `null`
- `flair_id` must resolve to an active flair definition owned by the same `guild_id` as the post
- in v0, `flair_id` must be `null` when `parent_post_id` is non-null; reply flair is future work
- flair is optional in v0 unless a guild later chooses to require one through guild settings
- flair is display and filtering metadata, not canonical domain truth
- system-derived facts must not be modeled as flair when Pirate already has a structured field for them

Examples of what should not be flair:

- `Remix` when `song_mode = remix`
- `18+` when `age_gate_policy = 18_plus`
- `Paid` when monetization or listing state already expresses that
- `Original` when `rights_basis = original`

Examples of good flair:

- `Question`
- `Announcement`
- `Review`
- `Theory`
- `Production`
- `Remix Feedback`
- `WIP`

### Presentation Fields

- `identity_mode`
  - `public`
  - `anonymous`
- `anonymous_scope`
  - `guild_stable`
  - `thread_stable`
  - `post_ephemeral`
  - `null`
- `anonymous_label` stores the derived anonymous label rendered to other users; it is `null` when `identity_mode = public`
- `disclosed_qualifiers_json` stores a snapshot of the disclosed verified qualifiers rendered with the post
- `author_user_id` is always stored on the post row regardless of identity mode

Suggested v0 `disclosed_qualifiers_json` item shape:

- `qualifier_template_id`
- `rendered_label`
- `qualifier_kind`
  - `verification_capability`
- `qualifier_source`
  Example: `verification_capabilities`
- `sensitivity_level`
- `redundancy_key`

### Presentation Eligibility

Anonymous-capable presentation is not valid for every post shape.

Recommended v0 rule:

- `text`, `image`, `video`, and `link` posts may use public or anonymous identity according to guild policy
- `song` posts must use public identity in v0
- live anchor posts must use public identity in v0
- disclosed qualifiers are only valid on anonymous posts in v0

Reasoning:

- song posts require stable authorship for rights review, Story publication, and payout routing
- live anchor posts require stable host identity for room authority, guest invitations, replay clearance, and payout release

### Anonymous Presentation Access Boundary

`author_user_id` on anonymously presented posts is privileged data. The following rules enforce the access boundary:

- the public API and standard read models must not return `author_user_id` on posts where `identity_mode = anonymous`
- guild moderators and other users must never see `author_user_id` on anonymously presented posts through any normal product surface
- only the privileged resolver path defined in [guild.md](./guild.md) may map an anonymous post back to `author_user_id`, and only through the audited break-glass workflow
- internal services and background jobs that need `author_user_id` for operational purposes must operate behind the privileged resolver boundary or receive explicit clearance to access the field
- `identity_mode`, `anonymous_label`, and `disclosed_qualifiers_json` are public presentation fields; they are visible in normal API responses

Anonymous post lifecycle is defined in [guild.md](./guild.md) under Anonymous Lifecycle Rules, including handling for guild bans, account deletion, policy flips, and re-verification loss.

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

### Song

Song posts represent native song uploads inside Pirate.

Rules:

- a song post must attach an asset
- a song post must publish that asset to Story in v0
- canonical song uploads remain subject to the guild's `artist_governance_state`

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
2. Pirate stores the blob in Filebase/IPFS or equivalent object storage
3. Pirate records media metadata
4. Pirate runs automated analysis where relevant
5. Pirate produces an upload decision
6. user chooses whether to continue as a social-only post or an asset-bearing post when policy allows it
7. Pirate creates or updates the post draft
8. Pirate decides whether the post can publish, needs user changes, or requires moderation review

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

Recommended v0 concerns:

- copyrighted-audio detection
- derivative/reference suggestions
- lyrics and transcript safety classification
- nudity or sexual-content detection for images and video where supported
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

Recommended v0 upload outcomes:

- `allow`
  Upload may proceed without required changes.
- `allow_with_required_reference`
  Upload may proceed only if the user attaches one or more required upstream references.
- `review_required`
  Upload may proceed only after moderation or compliance review.
- `blocked`
  Upload cannot proceed.

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

The following table defines the recommended v0 threshold policy mapping analysis signals to `content_safety_state` and `age_gate_policy` decisions by media type.

| Media type | Signal | `content_safety_state` | `age_gate_policy` | Notes |
|---|---|---|---|---|
| text / lyrics | no flagged content | `safe` | `none` | Default for clean text |
| text / lyrics | profanity (mild or strong) | `sensitive` | `none` | Profanity alone does not trigger `18_plus`; it surfaces the `sensitive` label |
| text / lyrics | sexual or adult language | `adult` | `18_plus` | Explicit sexual content triggers adult |
| text / lyrics | hate speech / violence | `pending` (escalated to moderation) | `18_plus` | Automated classification cannot set `adult` for hate/violence without human review; `content_safety_state` stays `pending` until a moderator resolves it. The `analysis_state` is set to `review_required` to route it into the moderation queue. |
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
- ambiguous or mixed signals should set `content_safety_state` to `pending` and `analysis_state` to `review_required` rather than defaulting `content_safety_state` to `safe`

Mapping to post fields:

- if no post row exists yet and the outcome is `blocked`, Pirate should not create a publishable post
- if guild posting policy rejects the write due to trust-tier or pacing rules, Pirate should reject the write directly rather than creating a pending moderation item
- trust-tier rejection and pacing rejection should remain distinct failure cases even when both come from guild posting policy; clients should be able to tell "not allowed at your current trust level" apart from "quota exhausted for now"
- when a draft post is created from an allowed upload, `analysis_state` should mirror the final non-blocking upload outcome
- the full reasoning and provider payload live on the shared `media_analysis_results` row referenced by `analysis_result_ref`
- `content_safety_state` and `age_gate_policy` should be copied from the final analysis outcome at post creation time and may later be tightened by moderation

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
  The author wants explicit attribution or guild-defined revenue sharing without Pirate assuming a strong legal copyright position.

`attribution_only` is especially useful for edge cases such as:

- memes
- formats or performance patterns
- other remix-adjacent content where guilds may want sharing norms even when legal status is less clean

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
- `song`
  - only available where guild posting policy allows it
  - canonical artist songs additionally require `artist_governance_state = artist_governed` or `org_governed`
  - should require at least one audio-bearing media item
  - should require lyric text at post-creation time
  - instrumental and vocal stems are optional at post-creation time; they may be attached later or derived through async enrichment
  - the song asset's `karaoke_ready` flag depends on `karaoke_package_ref` completeness, not on composer completeness (see karaoke.md)
  - lyrics should run through LLM-assisted safety classification in addition to any audio analysis
  - may include optional `title` and optional `caption`
- `song_mode = remix`
  - requires one or more upstream asset references
  - requires `rights_basis = derivative`

## Threading Model

V0 threading is post-based.

Rules:

- root feed posts have `parent_post_id = null`
- replies set `parent_post_id` to another post in the same guild
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
- `guild_id`
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

Rules:

- `status` on the post stores the current visible lifecycle state
- moderation records store the action history that led to that state
- moderators act within guild policy; platform admins retain fallback authority
- moderators may tighten `content_safety_state` or `age_gate_policy` after review, but should not weaken inherited upstream age gates without explicit admin tooling

## V0 Scope Notes

- reposts, crossposts, and quote-posts are not part of v0
- v0 top-level post types are intentionally narrow:
  - `text`
  - `image`
  - `video`
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
