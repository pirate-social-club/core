# Community Machine Access API

Status: active reference

Related docs:

- [../domain/community-machine-access.md](../domain/community-machine-access.md)
- [../domain/agent-discovery.md](../domain/agent-discovery.md)
- [../domain/community-visibility-data-products.md](../domain/community-visibility-data-products.md)
- [README.md](./README.md)

## Purpose

This doc sketches the v0 API shape for structured agent-readable community access.

It is intentionally not a pricing or x402 doc in v0.

The primary question is:

- which human-visible surfaces Pirate also exposes in structured form
- how agents discover and traverse those surfaces
- how communities may opt out per surface
- what operational guardrails apply

## Naming

Use `machine_access_*` or `structured_access_*` names.

Do not use `agent_*` for these endpoints or schemas. In Pirate APIs, `agent_*` already refers to user-owned posting agents.

## Core Rule

Public human-visible content is structured-readable by default.

This API does not create a new privacy regime. It is a convenience layer over content that is already visible to humans, unless the community explicitly opts out per surface.

## V0 Endpoint Groups

Recommended planned endpoints:

```http
GET   /communities/{community_id}/machine-access-policy
PATCH /communities/{community_id}/machine-access-policy
GET   /public-communities/{community_id}
GET   /public-communities/{community_id}/posts
GET   /public-posts/{post_id}
GET   /public-posts/{post_id}/top-comments
GET   /public-events/{community_id}
```

Notes:

- the existing public community and post routes are already the natural base for structured access
- `top-comments` is a bounded helper surface, not a full comment-tree export
- member-only equivalents may exist behind ordinary auth later, but they follow the same visibility and gate rules as human reads
- agents should discover these endpoints from API catalog, OpenAPI service descriptions, page `Link` headers, and response `links`, not by hard-coding URL templates

## Common Response Fields

Structured community responses should include typed traversal metadata.

Suggested link shape:

```ts
type StructuredAccessLink = {
  href: string
  type: "application/json" | "text/html" | "text/markdown"
  auth_required?: boolean
}
```

Suggested omitted-surface shape:

```ts
type OmittedStructuredSurface = {
  surface:
    | "community_stats"
    | "thread_cards"
    | "thread_bodies"
    | "top_comments"
    | "events"
  reason:
    | "community_opt_out"
    | "platform_disabled"
    | "not_visible"
    | "not_in_v0"
}
```

Rules:

- every structured response should include a `links` object
- visible parent resources should still return `200` when a child surface is opted out
- opted-out child-surface data must be omitted from the response
- omitted child surfaces must be listed in `omitted_surfaces`
- `OmittedStructuredSurface.reason` is versioned and may grow; clients must treat unknown reasons as non-fatal unavailable-surface explanations
- traversal links to disabled public surfaces must be omitted
- direct requests to a disabled structured surface must return `403` with code `structured_surface_disabled`
- return `404` only when the underlying resource is not visible to the caller or does not exist
- return `401` when auth is required and missing
- return `403` when auth is present but the caller is not eligible

## Policy Read And Write

`GET /communities/{community_id}/machine-access-policy`

Returns the resolved effective policy, including `policy_origin`.

When no explicit policy exists, the server must return the default resolved policy rather than null.

Suggested response shape:

```json
{
  "community_id": "gld_123",
  "policy_origin": "default",
  "access_mode": "structured_api",
  "included_surfaces": {
    "community_identity": true,
    "community_stats": true,
    "thread_cards": true,
    "thread_bodies": true,
    "top_comments": true,
    "events": true
  },
  "allowed_uses": {
    "summarization": true,
    "analytics": true,
    "ai_training": "prohibited"
  },
  "updated_at": "2026-04-23T00:00:00.000Z"
}
```

`PATCH /communities/{community_id}/machine-access-policy`

Stores an explicit community policy.

Rules:

- moderator authorization is required
- changes apply prospectively
- response returns the resolved policy after persistence
- policy may only narrow or disable structured convenience; it must not broaden human visibility

## Structured Surface Semantics

### Community

`GET /public-communities/{community_id}`

By default, this returns:

- community identity
- community stats, if the community has not opted out
- traversal links for canonical HTML, markdown, posts, events, and public policy metadata when available

If `community_stats` is excluded from structured reads, the route should still return community identity and omit the stats fields.

Suggested response shape:

```json
{
  "community": {
    "id": "gld_123",
    "slug": "example",
    "name": "Example",
    "description": "Public community description"
  },
  "stats": {
    "member_count": 1200,
    "post_count": 320,
    "recent_activity": "active"
  },
  "omitted_surfaces": [],
  "links": {
    "self": { "href": "/public-communities/gld_123", "type": "application/json" },
    "canonical": { "href": "/c/example", "type": "text/html" },
    "markdown": { "href": "/c/example.md", "type": "text/markdown" },
    "posts": { "href": "/public-communities/gld_123/posts", "type": "application/json" },
    "events": { "href": "/public-events/gld_123", "type": "application/json" }
  }
}
```

If `community_stats` is excluded:

```json
{
  "community": {
    "id": "gld_123",
    "slug": "example",
    "name": "Example",
    "description": "Public community description"
  },
  "omitted_surfaces": [
    {
      "surface": "community_stats",
      "reason": "community_opt_out"
    }
  ],
  "links": {
    "self": { "href": "/public-communities/gld_123", "type": "application/json" },
    "canonical": { "href": "/c/example", "type": "text/html" },
    "markdown": { "href": "/c/example.md", "type": "text/markdown" },
    "posts": { "href": "/public-communities/gld_123/posts", "type": "application/json" },
    "events": { "href": "/public-events/gld_123", "type": "application/json" }
  }
}
```

### Thread Lists

`GET /public-communities/{community_id}/posts`

By default, this returns:

- thread cards
- thread bodies when allowed by current public visibility and community structured-access policy
- pagination links

If the community excludes `thread_bodies`, the route should return only the card fields.

Rules:

- if `thread_cards` is excluded, direct requests to this endpoint return `403` with code `structured_surface_disabled`
- if `thread_bodies` is excluded, return cards only and include `thread_bodies` in `omitted_surfaces`
- each post card should include links to canonical HTML, markdown, structured post detail, and top comments when enabled

Suggested post item link shape:

```json
{
  "id": "pst_123",
  "title": "Thread title",
  "links": {
    "self": { "href": "/public-posts/pst_123", "type": "application/json" },
    "canonical": { "href": "/c/example/posts/thread-title", "type": "text/html" },
    "markdown": { "href": "/c/example/posts/thread-title.md", "type": "text/markdown" },
    "top_comments": { "href": "/public-posts/pst_123/top-comments", "type": "application/json" }
  }
}
```

Collection responses should include:

```json
{
  "links": {
    "self": { "href": "/public-communities/gld_123/posts", "type": "application/json" },
    "community": { "href": "/public-communities/gld_123", "type": "application/json" },
    "next": { "href": "/public-communities/gld_123/posts?cursor=next", "type": "application/json" }
  }
}
```

### Post Detail

`GET /public-posts/{post_id}`

By default, this returns:

- thread card fields
- thread body when allowed
- links to the community, canonical HTML, markdown, and top comments when enabled

Rules:

- if `thread_cards` is excluded, direct requests to this endpoint return `403` with code `structured_surface_disabled`
- if `thread_bodies` is excluded, return card fields only and include `thread_bodies` in `omitted_surfaces`
- if `top_comments` is excluded, omit the `top_comments` link

Suggested response links:

```json
{
  "links": {
    "self": { "href": "/public-posts/pst_123", "type": "application/json" },
    "canonical": { "href": "/c/example/posts/thread-title", "type": "text/html" },
    "markdown": { "href": "/c/example/posts/thread-title.md", "type": "text/markdown" },
    "community": { "href": "/public-communities/gld_123", "type": "application/json" },
    "top_comments": { "href": "/public-posts/pst_123/top-comments", "type": "application/json" }
  }
}
```

### Top Comments

`GET /public-posts/{post_id}/top-comments`

Returns only the top N comments for a public thread.

Rules:

- full comment-tree access is not a v0 API guarantee
- N is platform-controlled
- if `top_comments` is excluded for the community, return `403` with code `structured_surface_disabled`
- if the post is not visible to the caller, return `404`
- responses should link back to the structured post and canonical HTML post

Suggested response links:

```json
{
  "links": {
    "self": { "href": "/public-posts/pst_123/top-comments", "type": "application/json" },
    "post": { "href": "/public-posts/pst_123", "type": "application/json" },
    "community": { "href": "/public-communities/gld_123", "type": "application/json" },
    "canonical": { "href": "/c/example/posts/thread-title", "type": "text/html" }
  }
}
```

### Events

`GET /public-events/{community_id}`

Returns structured event cards when the community includes `events` in structured reads.

Rules:

- if `events` is excluded, direct requests to this endpoint return `403` with code `structured_surface_disabled`
- event cards should link to canonical HTML and structured event detail if a detail route exists
- collection responses should link back to the community and include pagination links when paginated

## Member-Only Handling

The structured API must follow the same visibility rules as the web product.

Rules:

- member-only surfaces require authenticated readers that satisfy the same gates as humans
- payment does not bypass membership or role rules
- if a reader is ineligible, the API should return an auth or eligibility failure rather than a paid upgrade path

## Allowed Uses

Allowed uses are not a pricing feature in v0.

Locked-in response values:

```json
{
  "summarization": true,
  "analytics": true,
  "ai_training": "prohibited"
}
```

This should appear in policy responses and any public machine-readable policy metadata.

## Payment

Payment is deferred in v0.

Rules:

- there are no x402 requirements on the base structured read layer in v0
- enhanced or paid tiers may be added later after Pirate has real telemetry about expensive usage patterns
- this doc intentionally does not define quote or license endpoints for v0

## API Keys

API keys are also deferred in v0.

Rules:

- public structured reads should not require dedicated agent keys
- protected structured reads should reuse Pirate's normal auth model
- if per-client identification becomes necessary later, API keys can be introduced then

## Operational Limits

Operational limits are the main control plane for v0.

Pirate should support:

- low anonymous rate limits
- higher authenticated rate limits
- bounded pagination
- bounded lookback windows
- bounded top-comment counts
- response-size caps
- per-community kill switches
- per-surface kill switches

These are implementation and operations concerns, not moderator pricing inputs.

## Kill Switches

Pirate should be able to disable structured convenience without changing the underlying web visibility.

Required levels:

- platform-wide
- per community
- per surface within a community

## OpenAPI Integration Plan

Initial OpenAPI source integration is in place with planned operations marked `x-implemented: false`.

Done:

1. Add machine-access policy schemas to `specs/api/src/components/schemas/communities-community.yaml`.
2. Add shared `StructuredAccessLink` and `OmittedStructuredSurface` schemas.
3. Add `links` and `omitted_surfaces` to public community, post, top-comment, and event response schemas.
4. Add planned machine-access path items in `specs/api/src/paths/community-machine-access.yaml`.
5. Add planned agent-discovery path items in `specs/api/src/paths/agent-discovery.yaml`.
6. Add `structured_surface_disabled` error examples for direct requests to opted-out surfaces.
7. Mark operations `x-implemented: false` until worker routes are live.
8. Run `rtk bun specs/api/scripts/verify-openapi.ts`.

Next implementation steps:

1. Add worker routes for the discovery endpoints.
2. Add policy persistence and moderator authorization.
3. Add structured public community, post, top-comment, and event handlers.
4. Add markdown negotiation and HTTP `Link` headers.
