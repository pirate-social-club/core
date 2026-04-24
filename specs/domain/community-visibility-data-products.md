# Community Visibility And Structured Agent Access

Status: draft

Related docs:

- [community.md](./community.md)
- [community-machine-access.md](./community-machine-access.md)
- [agent-discovery.md](./agent-discovery.md)
- [post.md](./post.md)
- [feed.md](./feed.md)
- [monetization.md](./monetization.md)

## Purpose

This doc defines the moderator-facing product model for community visibility and structured agent access.

It replaces the earlier commerce-first "data products" framing with a simpler v0 question:

- what is already visible to humans
- what Pirate exposes as a structured read surface for agents
- what exceptions a moderator may apply

Discovery, well-known metadata, markdown negotiation, and traversal links are defined separately in [agent-discovery.md](./agent-discovery.md).

## Core Principle

Pirate should not design a store first.

Pirate should design a faucet first.

For public content, agents can already read the page by scraping HTML. The value Pirate adds is a clean structured surface, not the basic permission to read.

So the moderator is mostly deciding:

- whether Pirate offers structured convenience for a surface
- or makes agents scrape the page instead

## Default Rule

For public communities, public human-visible surfaces are structured-readable by default.

This means most communities do not need to touch this tab.

The tab exists mainly for exceptions:

- exclude stats
- exclude thread bodies
- exclude top comments
- exclude events

## Surface Classes

The v0 moderator-facing surface classes are:

- community identity
- community stats
- discussion threads
- top comments
- events

Interpretation:

- `community identity`
  - name
  - slug
  - description
  - join requirements
  - created date
- `community stats`
  - member count
  - post count
  - recent activity
- `discussion threads`
  - thread cards and bodies for public threads
- `top comments`
  - the top N comments for a thread, not the full tree
- `events`
  - event cards such as title, host, time, and status

Community identity is always public in v0 and is not configurable here.

## Visibility Levels

Moderator-facing v0 choices should stay simple:

- `Public`
- `Members only`

Meaning:

- `Public`
  - humans may view it without joining
  - Pirate exposes it in the structured read layer by default unless the community opts out
- `Members only`
  - only community members who satisfy the same gates as humans may view it
  - structured access follows the same membership and gate rules

Payment does not bypass gates.

## Defaults

Suggested v0 defaults:

```ts
type CommunityStructuredAccessDefaults = {
  community_stats: "public"
  discussion_threads: "public"
  top_comments: "public"
  events: "public"
}
```

This is intentionally generous because Pirate wants assistants to be useful early.

## Top Comments Scope

Top comments need a narrow v0 rule.

Rule:

- top comments are included in structured reads by default for public threads
- full comment-tree access is deferred
- the count `N` is an operational server setting, not a moderator-controlled number

This supports assistant summaries such as:

- "the top comment says ..."
- "this reply got 3k upvotes"

without committing Pirate to heavy full-thread export behavior in v0.

## Member-Only Communities

Member-only handling is straightforward:

- the same surface classes may exist in the structured layer
- the same membership and gate rules apply
- only eligible authenticated agents may read them
- payment does not override membership, role, or other access rules

## Structured Access Modes

There are only two meaningful v0 modes:

- `Structured API`
- `Structured API + enhanced limits` (reserved for later)

There is no priced product picker in v0.

If Pirate later introduces pricing, it should attach to enhanced access after real bottlenecks are observed, not before.

## Allowed Uses

Allowed uses are intentionally small in v0:

- summaries: allowed
- analytics: allowed
- AI training: prohibited

AI training is not configurable in v0. It is a static prohibition.

This keeps the tab centered on assistant usefulness rather than training-company licensing.

## Payment

Payment is deferred in v0.

Rationale:

- public structured access is more valuable for adoption than early charging
- Pirate should first learn which surfaces and patterns are actually expensive
- if Pirate later gets hammered, payment can target the real bottleneck:
  - rate
  - depth
  - history window
  - bulk polling
  - export size

Until then, Pirate should use operational limits rather than productized pricing.

## Operational Limits

Pirate should ship operational guardrails from day one:

- anonymous rate limits
- authenticated rate limits
- bounded pagination
- bounded lookback windows
- response-size caps
- cache controls
- per-community kill switches
- per-surface kill switches

These are not moderator pricing controls. They are platform controls.

## Moderator UI

The moderation tab should be simple.

### Section 1: Agent access

- `Structured API`
- `Structured API + enhanced limits` (future-facing)

### Section 2: Included surfaces

Per surface:

- Community stats
- Discussion threads
- Top comments
- Event cards

Each one:

- included in structured API
- excluded from structured API

### Section 3: Allowed uses

- Summaries allowed
- Analytics allowed
- AI training: Prohibited

### Static notice

- operational limits are platform-managed
- payment is not active in v0
- if enhanced access later introduces settlement, Pirate may initially route it to the platform wallet until a better treasury model exists

## What This Tab Is For

This tab is for exceptions.

It is not there to make every community consciously opt into agent readability.

If public did not imply structured-readable by default, most communities would never configure the tab, and assistants would just scrape HTML instead.

That would make the feature mostly pointless.

So the intended usage is:

- default behavior works without moderator action
- moderators only visit the tab when they want to narrow structured convenience

## Deferred Questions

These questions are deferred until Pirate sees real production demand:

- whether enhanced access should require auth, API keys, payment, or some combination
- whether full comment-tree reads should be available at all
- whether long-horizon history windows should be free or enhanced-only
- whether special export or analytics products are worth naming separately later
