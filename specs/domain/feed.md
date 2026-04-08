# Feed

Status: draft

Related docs:

- [guild.md](./guild.md)
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
- guild-scoped feeds

The global front page is a Pirate product surface.
Guild ranking may become guild-governed later, but starts simple in v0.

## Top-Level Feed Surfaces

Recommended v0 primary surfaces:

- `Home`
- `Your Guilds`

Interpretation:

- `Home`
  Global trending or best content across all guilds.
- `Your Guilds`
  Feed composed from the guilds the user has joined.

This avoids the cold-start problem where a new user sees an empty personalized feed.

## Feed Ownership

### Platform-Owned

`Home` is platform-owned.

Rules:

- Pirate defines candidate generation and ranking policy for `Home`
- Pirate may tune `Home` globally over time
- `Home` is the front page of front pages

### User-Scoped

`Your Guilds` is user-scoped but still platform-operated in v0.

Rules:

- candidates come from guilds the user belongs to
- ranking is initially determined by Pirate's default policy
- later personalization can be added without changing the surface definition

### Guild-Scoped

Each guild has its own feed surface.

Rules:

- guild feeds are scoped to one `guild_id`
- v0 uses a simple default ranking policy
- guilds may gain governance control over ranking policy later

## Sort Modes

Recommended v0 sort modes for feed surfaces and guild pages:

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

## Flair Filtering

Guild feeds may optionally expose flair filtering when the guild has active flair definitions.

Recommended v0 behavior:

- flair filtering is available on guild-scoped feeds only
- flair filtering does not apply to `Home` or `Your Guilds` in v0
- the filter is single-select to match the one-flair-per-post model
- the default state is unfiltered
- selecting a flair narrows the guild feed to posts whose `flair_id` matches the selected definition

Rules:

- flair filtering happens during candidate eligibility or query construction before ranking, not as a client-only cosmetic filter after ranking
- flair filters must ignore archived definitions for new selection UI unless the current route is explicitly resolving a historical archived flair page
- replies should not participate in top-level guild flair filters unless Pirate later defines reply flair behavior
- flair filtering must not change ranking formulas beyond narrowing the candidate set
- flair labels in filter UI are rendered as the guild-authored canonical strings in v0; Pirate does not translate flair definitions as part of localized feed reads

Product boundary:

- flair is a guild-local navigation aid, not a platform-wide discovery primitive
- Pirate should avoid building cross-guild flair browse pages until there is clear evidence of stable shared semantics

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

## Guild Feed Defaults

Guild feeds should start simple.

Recommended v0 defaults:

- default guild sort: `best`
- alternative guild sorts:
  - `top`
  - `new`

Do not attempt guild-governed feed formulas in v0.

That can become a later governance feature once guilds have enough activity to justify it.

## Candidate Eligibility

Before ranking, posts must pass feed eligibility checks.

Eligibility filters include:

- top-level feed candidates must have `parent_post_id = null`
- post status must be viewable
- guild status must be active or otherwise readable
- viewer must satisfy guild viewer gates
- viewer must satisfy post or asset age gates
- moderation and safety policy must allow the post on that surface

Additional surface-specific constraints may apply later.

Replies belong to thread surfaces, not `Home`, `Your Guilds`, or guild top-level feeds.

## Ranking Inputs

The exact formula should remain flexible in v0, but the input classes should be explicit.

Suggested v0 ranking inputs:

- recency
- vote score
- comment count
- watch or engagement signals where available
- guild membership context for `Your Guilds`
- moderation penalties
- safety and age-gate filtering

Karma must not influence feed ranking in v0. See [karma.md](./karma.md) for the boundary between eligibility and visibility.

Rules:

- ranking should happen only after eligibility filtering
- ineligible posts should never be boosted by ranking logic
- guild-governed ranking later should still respect platform safety and gate constraints

## Cold Start Behavior

Recommended v0 behavior:

- new or logged-out users land on `Home`
- `Your Guilds` becomes useful after the user joins guilds
- if a user has no joined guilds, `Your Guilds` may render an empty state or redirect prompt rather than pretending to be `Home`

## Gate And Moderation Interaction

Feeds must respect:

- guild viewer gates
- post-level age gates
- asset-level locked/public access distinctions
- moderation state

Examples:

- a post in an `18+` guild should not appear to a viewer without valid age eligibility
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

- guild-scoped feeds should render the author's active handle in that guild namespace when one exists
- if the author has no active handle in that guild namespace, fall back to the active global `.pirate` handle
- mixed global feeds such as `Home` and `Your Guilds` should render a single display label in v0
- for mixed global feeds, that display label should be the active global `.pirate` handle
- richer multi-part identity rendering can be added later when the feed read model grows beyond one display field

Anonymous identity rendering:

- when a post is published under an anonymous identity layer, feeds must render the derived anonymous label as defined in [guild.md](./guild.md) under Anonymous Subject Derivation
- anonymous posts must never fall back to the author's `.pirate` handle or guild-local handle, regardless of the feed surface
- this applies to all feed surfaces including `Home`, `Your Guilds`, and guild-scoped feeds
- for guilds with anonymous posting enabled, feeds must reflect the author's chosen identity mode for that post rather than forcing anonymous rendering at the guild level
- if the post carries disclosed qualifier snapshots, feeds should render those same normalized qualifier pills adjacent to the author presentation surface rather than recomputing them from current verification state

## Pagination

All top-level feed surfaces should support cursor pagination in v0.

Recommended v0 rules:

- `Home`, `Your Guilds`, and guild-scoped feeds accept `cursor` and `limit`
- feed responses return `next_cursor` when another page exists
- pagination is for ordinary interactive browsing, not bulk export

## Inline Question Projection

Feed items may include nullable question projection data when the item is rendering a daily-question post or another question-linked feed card.

## On-chain vs Off-chain

Recommended v0 split:

- feed assembly and ranking are app-level concerns
- no on-chain ranking logic is required in v0
- guild governance may later influence ranking policy, but feed execution remains an app responsibility

## Open Questions

- Should `Home` and `Your Guilds` share the same `best` ranking formula, or should they diverge in v0?
- What minimum engagement signals should count in `best` before enough traffic exists for more advanced ranking?
- When guild governance eventually controls ranking policy, which parameters are configurable versus platform-enforced?
