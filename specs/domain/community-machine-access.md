# Community Machine Access

Status: current working spec

Related docs:

- [community.md](./community.md)
- [agent-discovery.md](./agent-discovery.md)
- [community-visibility-data-products.md](./community-visibility-data-products.md)
- [feed.md](./feed.md)
- [post.md](./post.md)
- [agent-ownership.md](./agent-ownership.md)
- [moderation.md](./moderation.md)

## Purpose

This doc defines Pirate's technical and policy model for machine-readable community access.

It answers:

- when Pirate offers a structured read surface instead of forcing HTML scraping
- how structured reads relate to agent discovery and traversal
- how structured reads follow human visibility rules
- what communities may opt out of
- what operational guardrails apply in v0

It does not define user-owned posting agents. Those remain in [agent-ownership.md](./agent-ownership.md).

## Naming Boundary

The `agent_*` namespace is already reserved for KYA-backed user-owned agents acting on behalf of verified humans.

Machine-readable access for crawlers, assistants, and external readers must use `machine_access_*`, `structured_access_*`, or similar names.

## Core Reframe

For public Pirate pages, the question is not whether agents can read.

They already can, by scraping HTML.

The real product question is:

- does Pirate provide a clean structured read surface
- or make agents scrape the page

So the moderator is not primarily deciding whether bots may see a public community.

The moderator is deciding whether Pirate offers structured convenience for that community, and for which surfaces.

## Default Rule

Public human-visible content is structured-readable by default.

Rules:

- if a surface is public to unauthenticated humans on Pirate, Pirate may expose that same surface in a structured API by default
- communities may opt out per surface
- opting out removes Pirate's structured convenience layer for that surface; it does not retroactively make the public web page private

This default exists because otherwise assistants fall back to scraping, which defeats the point of a structured read layer.

Discovery and traversal details live in [agent-discovery.md](./agent-discovery.md). That doc defines robots, sitemaps, markdown negotiation, well-known metadata, API catalog, OAuth metadata, MCP discovery, and response links.

## Member-Only Rule

Member-only content remains member-only for machine readers.

Rules:

- structured reads for member-only surfaces require authenticated readers that satisfy the same membership and gate requirements as humans
- payment does not bypass community gates
- role-limited or private surfaces follow the same rule: structured access may exist, but only for already eligible readers

## Surface Classes

The relevant v0 machine-readable surfaces are:

- community identity
- community stats
- thread cards
- thread bodies
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
- `thread card`
  - title
  - author handle when visible
  - timestamp
  - vote counts when visible
  - reply count
- `thread body`
  - full post body and attached public media metadata
- `top comments`
  - only the top N comments for a thread, not the full tree
- `events`
  - event card data such as title, host, schedule, and status

## Comments Scope

Comments need an explicit v0 boundary.

Rule:

- public communities expose top comments in structured reads by default
- full comment-tree access is deferred
- top-comment count `N` is an operational server control, not a moderator pricing control

This gives assistants enough context to summarize "what people are saying" without immediately opening the heaviest read path.

## Policy Shape

Suggested v0 resolved policy:

```ts
type CommunityMachineAccessPolicy = {
  community_id: string
  policy_origin: "default" | "explicit"
  access_mode: "structured_api" | "structured_api_enhanced"
  included_surfaces: {
    community_identity: true
    community_stats: boolean
    thread_cards: boolean
    thread_bodies: boolean
    top_comments: boolean
    events: boolean
  }
  allowed_uses: {
    summarization: true
    analytics: true
    ai_training: "prohibited"
  }
  operational_limits: {
    anonymous_rate_tier: "low"
    authenticated_rate_tier: "standard"
    top_comments_limit: number
    max_lookback_window: string
  }
  updated_at: string
}
```

Default v0:

```ts
{
  policy_origin: "default",
  access_mode: "structured_api",
  included_surfaces: {
    community_identity: true,
    community_stats: true,
    thread_cards: true,
    thread_bodies: true,
    top_comments: true,
    events: true,
  },
  allowed_uses: {
    summarization: true,
    analytics: true,
    ai_training: "prohibited",
  },
}
```

Notes:

- community identity is always included in v0
- `structured_api_enhanced` is a future operational tier, not a priced product in v0
- there is no per-post licensing model in v0

## Opt-Out Granularity

Communities may opt out per surface.

Rules:

- opt-out is per surface class, not only global
- a moderator should be able to say:
  - include thread cards, exclude top comments
  - include events, exclude stats
  - include stats, exclude thread bodies
- a community-level kill switch may disable all structured reads for that community if abuse requires it

This keeps the structured layer useful by default while giving communities narrow exception controls.

## Agent Traversal

Structured access should be easy to traverse.

Rules:

- structured responses should include typed links to adjacent resources
- agents should be able to move from community identity to posts, post detail, top comments, events, canonical HTML, and markdown without constructing URL templates
- links to opted-out surfaces should be omitted
- parent resources should still be readable when only a child surface is opted out
- direct requests for opted-out structured surfaces should return a typed disabled-surface response

The API response contract for links and omitted surfaces lives in [../api/community-machine-access.md](../api/community-machine-access.md).

## Human Visibility Orthogonality

Structured access is downstream of human visibility, not a separate privacy regime.

Rules:

- structured access must never make a human-private surface public
- structured access may be narrower than the public web surface if the community opts out for convenience reasons
- structured access defaults follow human visibility, but community exceptions are allowed

## Allowed Uses

Allowed use policy is intentionally minimal in v0.

Locked-in v0 defaults:

- summarization: allowed
- analytics: allowed
- AI training: prohibited

AI training is not a configurable v0 product surface. It is a static prohibition.

The point of v0 machine access is assistant usefulness, not training-data licensing.

## Payment

Payment is deferred in v0.

Rules:

- Pirate does not price structured access in the initial rollout
- Pirate should first learn where the real operational bottlenecks are
- if structured access later becomes expensive to serve at scale, Pirate may introduce enhanced or paid tiers targeting the specific bottlenecks observed in production

This means v0 is not a store. It is a structured faucet with guardrails.

## API Keys

API keys are also deferred in v0.

Rules:

- v0 should rely on normal auth where auth is already required
- public structured reads should not require separate agent API keys
- per-client API keys may be added later if telemetry and rate-limit tuning require them

Rationale:

- keys add friction to the "let my assistant read this community" use case
- Pirate can get useful early telemetry from request metadata, auth context, and rate-limit events before introducing keys

## Operational Guardrails

Operational control matters more than pricing in v0.

Pirate should ship:

- anonymous rate limits
- authenticated rate limits
- bounded pagination
- bounded lookback windows
- response-size caps
- cache headers and server-side caching where appropriate
- per-surface kill switches
- per-community kill switches
- observability for request volume and hot surfaces

These are server controls, not moderator pricing controls.

## Kill Switches

Pirate should be able to disable structured access quickly when abuse appears.

Required kill-switch levels:

- platform-wide
- per community
- per surface within a community

The kill switch removes the structured convenience layer. It does not redefine the underlying web visibility.

## Moderation UI

The moderation surface should focus on exceptions, not the default.

Default story:

- public surfaces are structured-readable
- top comments are included by default
- AI training is prohibited
- no payment settings are shown

Moderator controls should focus on:

- access mode
  - `Structured API`
  - `Structured API + enhanced limits` (future-facing, optional to expose later)
- included surfaces
  - community stats
  - thread cards
  - thread bodies
  - top comments
  - events
- a static AI-training prohibition note
- a plain operational/revenue notice if Pirate later introduces enhanced tiers

This keeps the tab about structured convenience and exceptions, not about commerce.

## Open Questions

The main open questions after this spec are operational, not conceptual:

- what exact anonymous and authenticated rate tiers should v0 start with
- what exact top-comment count should the server return by default
- what lookback window should public structured reads expose by default
- whether full thread bodies should remain included by default for all public communities or be a narrower opt-in surface
