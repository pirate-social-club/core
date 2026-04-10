# Feed

Status: draft

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [identity-presentation.md](./identity-presentation.md)
- [asset.md](./asset.md)
- [user.md](./user.md)
- [karma.md](./karma.md)
- [questions.md](./questions.md)
- [localization.md](./localization.md)

## Purpose

This doc defines Pirate's feed surfaces, sort modes, and ranking ownership model.

It covers:

- top-level feed surfaces
- feed ownership
- sort modes
- ranking inputs
- gate and moderation filtering
- author identity rendering

## Non-goals

This doc does not define:

- exact ranking formulas
- ML personalization systems
- notification ranking
- advertising or sponsored content

## Core Principle

Pirate should distinguish between:

- platform-owned global discovery feeds
- user-scoped membership feeds
- community-scoped feeds

The global front page is a Pirate product surface.
Community ranking may become club-governed later, but starts simple in v0.

## Top-Level Feed Surfaces

Recommended v0 primary surfaces:

- `Home`
- `Your Communities`

Interpretation:

- `Home`
  Global trending or best content across all communities.
- `Your Communities`
  Feed composed from the communities the user has joined.

This avoids the cold-start problem where a new user sees an empty personalized feed.

## Feed Ownership

### Platform-Owned

`Home` is platform-owned.

Rules:

- Pirate defines candidate generation and ranking policy for `Home`
- Pirate may tune `Home` globally over time
- `Home` is the front page of front pages

### User-Scoped

`Your Communities` is user-scoped but still platform-operated in v0.

Rules:

- candidates come from communities the user belongs to
- ranking is initially determined by Pirate's default policy
- later personalization can be added without changing the surface definition

### Community-Scoped

Each club has its own feed surface.

Rules:

- community feeds are scoped to one `community_id`
- v0 uses a simple default ranking policy
- communities may gain governance control over ranking policy later

## Sort Modes

Recommended v0 sort modes for feed surfaces and club pages:

- `best`
- `top`
- `new`

Interpretation:

- `best`
  Default relevance/trending sort for the current surface
- `top`
  Highest-performing posts within a selected time window
- `new`
  Most recent posts first

## Label Filtering

Community feeds may optionally expose label filtering when the club has active label definitions.

Recommended v0 behavior:

- label filtering is available on community-scoped feeds only
- label filtering does not apply to `Home` or `Your Communities` in v0
- the filter is single-select to match the one-label-per-post model
- the default state is unfiltered
- selecting a label narrows the community feed to posts whose `label_id` matches the selected definition

Rules:

- label filtering happens during candidate eligibility or query construction before ranking, not as a client-only cosmetic filter after ranking
- label filters must ignore archived definitions for new selection UI unless the current route is explicitly resolving a historical archived label page
- replies should not participate in top-level club label filters unless Pirate later defines reply label behavior
- label filtering must not change ranking formulas beyond narrowing the candidate set
- labels in filter UI are rendered as the club-authored canonical strings in v0; Pirate does not translate label definitions as part of localized feed reads

Product boundary:

- labels are a community-local navigation aid, not a platform-wide discovery primitive
- Pirate should avoid building cross-community label browse pages until there is clear evidence of stable shared semantics

## Top Time Windows

`top` should support time windows.

Recommended v0 windows:

- `now`
- `today`
- `this_week`
- `this_month`
- `all_time`

Interpretation:

- `now`
  Very short-horizon trending window
- `today`
  Current-day performance
- `this_week`
  Rolling weekly performance
- `this_month`
  Rolling monthly performance
- `all_time`
  Historical top content

## Community Feed Defaults

Community feeds should start simple.

Recommended v0 defaults:

- default club sort: `best`
- alternative club sorts:
  - `top`
  - `new`

Do not attempt club-governed feed formulas in v0.

That can become a later governance feature once communities have enough activity to justify it.

## Candidate Eligibility

Before ranking, posts must pass feed eligibility checks.

Eligibility filters include:

- top-level feed candidates must have `parent_post_id = null`
- post status must be viewable
- club status must be active or otherwise readable
- viewer must satisfy club viewer gates
- viewer must satisfy post or asset age gates
- moderation and safety policy must allow the post on that surface

Additional surface-specific constraints may apply later.

Replies belong to thread surfaces, not `Home`, `Your Communities`, or club top-level feeds.

## Ranking Inputs

The exact formula should remain flexible in v0, but the input classes should be explicit.

Suggested v0 ranking inputs:

- recency
- vote score
- comment count
- watch or engagement signals where available
- club membership context for `Your Communities`
- moderation penalties
- safety and age-gate filtering

Karma must not influence feed ranking in v0. See [karma.md](./karma.md) for the boundary between eligibility and visibility.

Rules:

- ranking should happen only after eligibility filtering
- ineligible posts should never be boosted by ranking logic
- club-governed ranking later should still respect platform safety and gate constraints
- platform-owned discovery feeds must not use raw join counts or raw membership counts as ranking inputs
- if join velocity or membership growth signals are used for platform discovery, only joins from accounts with verified `unique_human` state should count
- platform-owned discovery should prefer strong-human-qualified membership signals over weaker anti-Sybil credentials when using membership context at all

## Cold Start Behavior

Recommended v0 behavior:

- new or logged-out users land on `Home`
- `Your Communities` becomes useful after the user joins communities
- if a user has no joined communities, `Your Communities` may render an empty state or redirect prompt rather than pretending to be `Home`

## Gate And Moderation Interaction

Feeds must respect:

- club viewer gates
- post-level age gates
- asset-level locked/public access distinctions
- moderation state

Examples:

- a post in an `18+` club should not appear to a viewer without valid age eligibility
- a post attached to a locked asset may still be feed-eligible if the post itself remains viewable under feed policy
- removed posts should not rank

## Localized Feed Reads

Feed reads should be locale-aware first-class product surfaces, not generic post dumps.

Rules:

- feed endpoints should accept an optional `locale` override
- feed assembly should resolve one authoritative locale before ranking and rendering
- each feed item should preserve canonical source text while also returning localized translated projections for the resolved locale
- feed cards showing translated text should expose a one-tap inline `Show original` affordance

Recommended localized feed fields:

- `resolved_locale`
- `translation_state`
- `machine_translated`
- `translated_body` nullable
- `translated_caption` nullable
- `source_hash`

Canonical source metadata:

- `post.source_language` remains canonical post metadata rather than a duplicated feed-level field

Translation behavior:

- default-tier translations may be prewarmed asynchronously or resolved lazily on first read behind the same cache contract
- non-tier translations should resolve lazily on first read and then be cached
- if translation is unavailable or blocked by policy, the feed should fall back to canonical original text with `machine_translated = false`
- `translation_state`
  - `ready`
  - `pending`
  - `same_language`
  - `policy_blocked`

## SSR Locale Contract

Feed SSR should follow the locale contract defined in [localization.md](./localization.md).

Required precedence:

1. user `preferred_locale`
2. explicit route or surface override
3. request `Accept-Language`
4. default `en`

Hydration rule:

- if SSR rendered with a non-English authoritative locale, hydration should not downgrade it to English
- if SSR rendered English only because no stronger server signal existed, hydration may promote to the client's actual non-English locale after mount

## Author Identity Rendering

Feed surfaces should render identity consistently.

Recommended v0 rules:

- community-scoped feeds should render the author's active handle in that club namespace when one exists
- if the author has no active handle in that club namespace, fall back to the active global `.pirate` handle
- mixed global feeds such as `Home` and `Your Communities` should render a single display label in v0
- for mixed global feeds, that display label should be the active global `.pirate` handle
- richer multi-part identity rendering can be added later when the feed read model grows beyond one display field
- for `authorship_mode = user_agent` posts, the two-part agent byline replaces the single-display-label rule on every feed surface including mixed global feeds
- when `authorship_mode = user_agent`, feeds should render from the post-row snapshots rather than resolving owner identity through a deep read-time join
- user-agent bylines should use `agent_display_name_snapshot` plus `agent_owner_handle_snapshot`
- recommended v0 rendering is plain text such as `C3PO AI · owned by luke.tld`
- `agent_ownership_record_id` remains an audit or moderation join key, not a required feed-time lookup

Anonymous identity rendering:

- when a post is published under an anonymous identity layer, feeds must render the derived anonymous label as defined in [community.md](./community.md)
- anonymous posts must never fall back to the author's `.pirate` handle or community-local handle, regardless of the feed surface
- this applies to all feed surfaces including `Home`, `Your Communities`, and community-scoped feeds
- for communities with anonymous posting enabled, feeds must reflect the author's chosen identity mode for that post rather than forcing anonymous rendering at the club level
- if the post carries disclosed qualifier snapshots, feeds should render those same normalized qualifier pills adjacent to the author presentation surface rather than recomputing them from current verification state
- because user-owned agent posts must use `identity_mode = public` in v0, feeds must not render anonymous user-agent bylines

## Pagination

All top-level feed surfaces should support cursor pagination in v0.

Recommended v0 rules:

- `Home`, `Your Communities`, and community-scoped feeds accept `cursor` and `limit`
- feed responses return `next_cursor` when another page exists
- pagination is for ordinary interactive browsing, not bulk export

## Inline Question Projection

Feed items may include nullable question projection data when the item is rendering a daily-question post or another question-linked feed card.

## On-chain vs Off-chain

Recommended v0 split:

- feed assembly and ranking are app-level concerns
- no on-chain ranking logic is required in v0
- club governance may later influence ranking policy, but feed execution remains an app responsibility

## Open Questions

- Should `Home` and `Your Communities` share the same `best` ranking formula, or should they diverge in v0?
- What minimum engagement signals should count in `best` before enough traffic exists for more advanced ranking?
- When club governance eventually controls ranking policy, which parameters are configurable versus platform-enforced?
