# Market Context

Status: draft

Related docs:

- [post.md](./post.md)
- [feed.md](./feed.md)
- [community.md](./community.md)

## Purpose

This doc defines Pirate's market-context sidecar for posts.

It covers:

- the product primitive and naming
- when market context is eligible to attach to a post
- community-level policy and defaults
- async extraction, search, matching, and abstention
- storage shape and read-model boundaries
- feed and post read integration
- moderator controls
- provider-profile ownership

It does not cover:

- trading flows
- market creation
- settlement or resolution logic
- ranking formulas that directly use market prices
- a generalized fact-checking system

## Core Principle

Market context is optional grounding context for a post.

It is:

- a read-side enrichment
- derived by trusted server-side analysis
- attached only when the system can confidently map a post to one or more externally resolvable claims

It is not:

- a canonical truth score
- a publish gate
- a post type
- a moderation verdict
- a promise that the linked markets are correct, fair, or liquid enough to settle every epistemic dispute

## Naming

The product primitive should be `market_context`.

User-facing language should prefer phrases such as:

- `Related market context`
- `Market context`
- `Related markets`

Do not make `prediction market` the primary product noun in Pirate UI.

Reason:

- the feature exists to add grounding context to claims
- Pirate is not asserting that markets are truth oracles
- the attachment is informational, not dispositive

Suggested canonical setting name:

- `market_context_policy`

## Relationship To Posts

Market context attaches to posts as a sidecar.

It must not:

- introduce a new `post_type`
- overload `analysis_state`
- change the canonical `posts` row shape for basic post identity

Reason:

- canonical post types are intentionally small and explicit
- `analysis_state` currently serves publishability and moderation-hold semantics for post creation
- market context is enrichment-only and must not pollute that gate

## Relationship To Post Analysis

Market context is produced by post analysis infrastructure, but it is not part of the publish-gating analysis enum.

Rules:

- market-context generation may run after a post is created
- market-context generation may start during the broader post-analysis workflow
- market-context failure or abstention must not by itself block publication
- market-context attachment must have its own lifecycle separate from `posts.analysis_state`

Recommended lifecycle:

- `none`
- `pending`
- `attached`
- `no_match`
- `detached`

Meanings:

- `none`
  No market-context record exists yet or the feature is disabled for the post.
- `pending`
  Extraction and provider search are in flight.
- `attached`
  One or more related markets were attached.
- `no_match`
  The system intentionally abstained or found no qualifying market.
- `detached`
  A previously attached market-context object was removed from public presentation, usually by moderation or a disabling policy change.

V1 rule:

- do not introduce `review_required` for market context
- uncertain matching should resolve to `no_match`, not a moderator queue

## What Counts As Eligible

Market context should attach only to narrow claim-bearing posts.

### V1 Eligible Inputs

- top-level `link` posts
- published or otherwise viewable posts
- posts whose target URL, title, and derived preview content provide enough text for claim extraction

### V1 Ineligible Inputs

- replies
- `text` posts
- `image` posts
- `video` posts
- `song` posts
- posts with no credible claim-bearing source material

### Future Inputs

Later versions may support:

- `image` posts via OCR
- `video` posts via transcript extraction

Those remain out of scope for v1 even if the policy schema is future-compatible.

## What Kinds Of Claims Qualify

Market context works best for claims that are:

- discrete
- time-bounded
- externally resolvable
- semantically close to an actual market question

Good examples:

- whether a bill passes by a named date
- whether a candidate wins a named race
- whether a company ships or announces a named milestone by a deadline
- whether an asset crosses a specific threshold by a deadline

Bad examples:

- broad ideological framing
- causal explanation claims
- vibes-based outrage headlines
- ambiguous narratives with no clear resolution condition
- low-specificity propaganda headlines that do not map to one concrete outcome

If a post contains only the bad forms above, the system should abstain.

## Community Policy

Communities should control whether market context is used, but v1 should start with sensible defaults and a small tuning surface.

Suggested v1 field:

- `market_context_policy`

Storage note:

- the stored community setting may be `null` at create time
- `null` does not mean the community has no market-context policy
- the server must resolve the platform default policy whenever no explicit community policy has been configured yet
- community activation must not be blocked on setting an explicit market-context policy

### Suggested V1 Shape

- `mode`
  - `off`
  - `on`
- `enabled_post_types`
  - array of post types
- `max_markets_per_post`
- `provider_set`
  - `platform_default`
  - `approved_profile`
- `market_context_profile_id` nullable

Interpretation:

- `mode = off` disables new market-context attachment for the community
- `mode = on` enables attachment for eligible post types
- `enabled_post_types` is future-compatible, but v1 should permit only `link`
- `max_markets_per_post` limits display and storage fanout
- `provider_set = platform_default` means Pirate uses the current platform-owned provider profile
- `provider_set = approved_profile` means the community selected one specific Pirate-approved profile
- v1 does not expose a per-community match-confidence threshold; Pirate uses one platform-managed minimum uniformly across communities

### V1 Defaults When Unset

If `market_context_policy` is `null`, the effective policy must resolve to:

- `mode = on`
- `enabled_post_types = ['link']`
- `max_markets_per_post = 2`
- `provider_set = platform_default`
- `market_context_profile_id = null`

### V1 Rules

- public community creation may omit `market_context_policy`
- market-context policy is not a lifecycle gate for community activation
- read surfaces should return the resolved effective policy even when no explicit row has been stored yet
- read surfaces should indicate whether the policy is `default` or `configured`
- flipping `mode` from `on` to `off` prevents new attachments but does not retroactively detach already attached market-context rows
- policy changes otherwise apply prospectively for new and newly refreshed attachments

### V1 Non-Goals For Community Policy

Do not expose these as community settings in v1:

- provider-specific raw knobs
- liquidity thresholds
- LLM prompt variants
- moderation-review thresholds

Those remain platform-managed until the feature proves stable.

## Platform-Owned Profiles

Provider choice should follow the same platform-owned profile posture used elsewhere in Pirate.

Suggested platform-owned profile shape:

- `market_context_profile_id`
- `profile_key`
- `provider_keys`
- `status`
  - `active`
  - `archived`

Rules:

- communities should not submit raw provider hostnames or custom search logic
- communities may choose only from platform-approved profiles
- Pirate may change the internal matching strategy for a profile without changing the community-facing contract

Recommended default provider profile for v1:

- Kalshi
- Polymarket

V1 exclusion:

- do not include Predict.fun in the default profile

Reason:

- the current public docs describe the REST API as beta
- mainnet usage requires an API key
- it is not yet appropriate as the default provider set for every community

## Provider Use Posture

V1 market context is informational and read-only.

Rules:

- provider integrations are used to read market discovery and snapshot data
- Pirate does not treat linked providers as canonical truth or moderation authorities
- Pirate should not frame the UI as trading encouragement
- linked market pages are informational references, not an endorsement of trading access in the viewer's jurisdiction

## Async Pipeline

Market context should be generated asynchronously.

### Job Ownership

The feature should use Pirate's jobs system rather than bespoke orchestration.

Recommended job shape:

- `job_type = market_context_match`
- `subject_type = post`
- `subject_id = post_id`

This keeps retries, claim/attempt tracking, and backoff inside existing operational patterns.

### V1 Pipeline

1. Read the post and resolved community market-context policy.
2. Check eligibility.
3. Derive a normalized input bundle from:
   - `link_url`
   - `title`
   - derived preview text when available
4. Run a claim-extraction step.
5. If extraction abstains, persist `no_match`.
6. Search provider APIs using the extracted claim candidates.
7. Rank candidate markets by semantic similarity, resolution fit, and platform-owned quality heuristics.
8. Attach up to `max_markets_per_post` markets.
9. Persist a snapshot for read models.

### Extraction Contract

The LLM should extract claims, not directly decide provider matches in one opaque step.

Input-source note:

- v1 should assume preview text is derived at job time by fetching the linked page or other server-side metadata source
- v1 does not require a new canonical post field to durably store link-preview text
- if Pirate later introduces a durable preview-cache object, market-context extraction may read from that cache instead of refetching

Recommended extraction output:

- `claim_candidates[]`
- `should_attach`
- `confidence`

Each claim candidate should include:

- normalized claim text
- entity list
- timeframe or deadline when inferable

Rules:

- extraction and provider search should be separate steps
- the extraction output should be testable without live provider calls
- the system should prefer abstention over speculative claims
- provider calls should respect documented rate limits and use cached claim-market bindings as the primary call-reduction mechanism

## Matching And Abstention

Abstention is a first-class success case.

Rules:

- the system must not force a market attachment onto every eligible post
- the system should attach only when it finds a close enough claim-market match
- if multiple weak matches exist, the result should be `no_match`
- if strong matches exist, attach only the best small set

Recommended selection rules:

- prefer markets with clear resolution criteria
- prefer markets whose timeframe matches the extracted claim
- prefer markets with enough platform-approved quality to avoid obvious junk results
- cap attached markets at the resolved `max_markets_per_post`

## Event-Level Deduplication

Multiple posts may point to the same underlying claim cluster.

Pirate should support shared claim-market bindings so duplicate discovery work is reduced.

Suggested object:

- `claim_market_binding`

Suggested purpose:

- keep shared market lookup caches out of the control-plane schema until the worker has a concrete reuse strategy

Scope:

- community policy still applies when deciding how many of those globally bound markets, if any, should attach to a given post

Rules:

- deduplication is an optimization layer, not a substitute for per-post eligibility
- each post still owns its own attach/detach state
- a reused claim binding must still respect the post's community policy and display limits

## Storage Model

Canonical post rows should remain lean.

Recommended v1 storage:

- `post_market_contexts`
- `post_market_context_markets`

### `post_market_contexts`

Suggested fields:

- `post_market_context_id`
- `post_id`
- `community_id`
- `status`
- `claim_summary`
- `matching_evidence_json`
- `snapshot_at`
- `created_at`
- `updated_at`

Rules:

- `matching_evidence_json` is private server-side evidence
- `matching_evidence_json` must not be returned to ordinary clients
- `claim_summary` is a public-safe human-readable summary of the matched claim cluster when one exists

### `post_market_context_markets`

Suggested fields:

- `market_context_market_id`
- `post_market_context_id`
- `provider_key`
- `provider_market_id`
- `provider_event_id` nullable
- `question`
- `outcome_yes_price`
- `liquidity_score` nullable
- `resolve_date` nullable
- `market_url`
- `match_confidence`
- `snapshot_at`
- `status`
- `created_at`
- `updated_at`

Suggested statuses:

- `active`
- `removed_by_mod`
- `pinned`

V1 rule:

- do not require `pinned` behavior in the first shipped moderator surface
- the storage model may reserve the state for later use
- v1 may omit an explicit resolution-state column and rely on `snapshot_at` plus `resolve_date` to signal freshness and likely settlement age
- a later version may add explicit settlement or resolution state if Pirate needs differentiated rendering for resolved markets

### Split Between Public Rows And Private Evidence

The storage model should mirror Pirate's broader pattern:

- public-safe derived attachment data lives in public read models
- private matching evidence, raw provider diagnostics, and search traces stay in server-side storage

## Read Models

Market context should be a nullable addition to post read surfaces.

It should not become:

- a new feed item type
- a label
- a badge or pill

### Feed Integration

`FeedItem` should gain a nullable `market_context` field.

Suggested summary shape:

- `status`
- `markets[]`

Suggested public-safe statuses:

- `attached`
- `no_match`

Rules:

- `markets[]` should be populated only when `status = attached`
- feeds may omit `market_context` entirely when no record exists yet
- clients should render `no_match` as no visible module in ordinary UI

Suggested market row fields:

- `provider_key`
- `question`
- `outcome_yes_price`
- `liquidity_score` nullable
- `resolve_date` nullable
- `market_url`
- `snapshot_at`

### Post Detail Integration

Post detail may return the same summary object as feed reads, with room for fuller text presentation.

V1 rule:

- do not expose private matching evidence to clients

## UI Constraints

Market context should read like a compact informational note under a post.

Rules:

- use plain text rows
- do not use badges or pills
- do not use decorative provider logos
- do not imply a stronger claim than "related market context"
- always show snapshot time when displaying a price-derived probability

Good v1 presentation:

- provider name
- market question
- current yes price or implied probability
- resolve date when known
- snapshot time

If multiple providers are attached:

- show each separately
- do not collapse them into one synthetic truth score

## Moderator Controls

V1 moderator controls should stay narrow.

Recommended controls:

- remove the attachment from a post
- disable market context for the community

V1 non-goals:

- full moderator review queues for uncertain matches
- per-provider tuning in community settings
- pinning a preferred market on individual posts as a required launch feature

## Ranking And Enforcement Boundary

Market context should not directly affect feed ranking in v1.

Rules:

- no rank boost because a market attachment exists
- no publish block because no market was found
- no automatic moderation action because an attached market price is low or high

This keeps the feature informational and reduces the risk of overclaiming epistemic certainty.

## Refresh Semantics

Attached market prices age quickly.

Rules:

- Pirate should persist a snapshot timestamp on every attached market row
- Pirate may refresh market-context snapshots asynchronously
- refresh cadence is a platform concern, not a per-community setting in v1
- stale attachments may remain visible if marked with their snapshot time rather than disappearing abruptly

## Notifications

V1 should not create a user notification family for market-context attachment or refresh.

Reason:

- the feature is contextual read enrichment, not a user-action event
- notifications would create noise without clear product value

## Summary

Market context in Pirate v1 should be:

- a post sidecar, not a post type
- async, not publish-gating
- community-configurable, with a resolved platform default
- link-only in v1
- read-only and informational
- aggressively abstention-friendly
- stored as public-safe derived rows plus private matching evidence
