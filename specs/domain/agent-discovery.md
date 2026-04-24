# Agent Discovery

Status: current working spec

Related docs:

- [community-machine-access.md](./community-machine-access.md)
- [community-visibility-data-products.md](./community-visibility-data-products.md)
- [feed.md](./feed.md)
- [post.md](./post.md)
- [agent-ownership.md](./agent-ownership.md)
- [../api/community-machine-access.md](../api/community-machine-access.md)

## Purpose

This doc defines how external agents discover Pirate's public and authenticated structured read surfaces.

It complements [community-machine-access.md](./community-machine-access.md), which defines what agents may read.

This doc answers:

- how agents find machine-readable entrypoints without prior URL-template knowledge
- how public web pages advertise structured alternatives
- how protected/member-only reads advertise auth requirements
- how agents traverse public community content through typed links

It does not define user-owned posting agents. Those remain in [agent-ownership.md](./agent-ownership.md).

## Authority Boundary

This doc owns:

- discovery principles
- discovery entrypoints
- link-relation vocabulary
- traversal requirements
- bootstrap metadata requirements

[../api/community-machine-access.md](../api/community-machine-access.md) owns:

- concrete response shapes
- HTTP status codes
- schema-level enums
- error codes
- endpoint-specific examples

If the two docs appear to conflict on response shape or status behavior, the API doc is authoritative.

## Core Rule

Agent discovery is a map, not a permission grant.

Discovery metadata may advertise structured surfaces, but every linked surface must still enforce:

- human visibility rules
- community machine-access policy
- per-surface opt-outs
- platform rate limits and kill switches
- auth and membership gates for protected content

## Discovery Goals

Pirate should make the happy path obvious for assistants, crawlers, and agent runtimes:

- find the public site map
- discover API descriptions
- discover structured alternatives for public pages
- negotiate markdown when an agent wants text instead of HTML
- discover auth metadata for protected/member-only reads
- discover MCP/WebMCP capabilities without making MCP the canonical content model
- traverse community, post, comment, and event content through response links

Agents should not need to reverse-engineer Pirate URL templates to move from one structured surface to the next.

## Public Discovery Entrypoints

Pirate should expose these unauthenticated discovery entrypoints in v0:

```http
GET /.well-known/api-catalog
GET /.well-known/service-desc/public.openapi.json
GET /.well-known/mcp/server-card.json
GET /.well-known/agent-skills/index.json
GET /.well-known/oauth-authorization-server
GET /.well-known/oauth-protected-resource
GET /.well-known/openid-configuration
GET /robots.txt
GET /sitemap.xml
```

Rules:

- all discovery documents must be cacheable with explicit cache headers
- JSON discovery documents must return `Content-Type: application/json`
- browser-readable discovery documents should support permissive read-only CORS
- discovery endpoints must not reveal private community membership, private posts, or private event details
- protected-resource metadata may describe how auth works, but not disclose protected content

## Robots And Content Signals

`/robots.txt` should advertise Pirate's public sitemap and crawl posture.

Rules:

- include sitemap directives for public sitemap indexes
- do not use robots rules as the primary community opt-out mechanism
- community structured-access opt-outs apply at the API response layer, not by mutating global robots rules
- if Pirate publishes AI bot rules or content-signal metadata, they must reflect the v0 allowed-use policy:
  - summarization allowed
  - analytics allowed
  - AI training prohibited

Robots and content signals are discovery and policy hints. Server authorization remains authoritative.

## Sitemap

Pirate should maintain a public sitemap index for human-visible public pages.

Public sitemap entries may include:

- public community pages
- public post pages
- public event pages
- public profile pages where applicable
- public topic/feed pages where applicable

Rules:

- private, role-limited, and member-only content must not appear in public sitemaps
- sitemap entries should include `lastmod` when Pirate can compute it cheaply
- sitemap inclusion does not imply structured API inclusion if a community opts out of a surface
- structured API responses should still expose traversal links even when a page is not sitemap-listed

## Markdown Negotiation

Public HTML pages should expose a markdown representation for agent-readable text extraction.

Recommended behavior:

```http
Accept: text/markdown
```

Rules:

- markdown output must represent the same human-visible content as the HTML page
- markdown output must respect community opt-outs for structured-only surfaces when those surfaces are not already visible on the page
- markdown output should include canonical links back to the HTML page and structured API response
- markdown is a content-accessibility path, not the canonical API model

## HTTP Link Headers

Pirate should advertise discovery and traversal metadata with HTTP `Link` headers on public HTML pages and structured responses.

Recommended root-level links:

```http
Link: </.well-known/api-catalog>; rel="service-meta"; type="application/linkset+json"
Link: </.well-known/service-desc/public.openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"
Link: </.well-known/mcp/server-card.json>; rel="mcp"; type="application/json"
Link: </.well-known/agent-skills/index.json>; rel="agent-skills"; type="application/json"
Link: </.well-known/oauth-authorization-server>; rel="oauth-authorization-server"; type="application/json"
Link: </.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"
```

Recommended page-level links:

```http
Link: </communities/{community_id}>; rel="canonical"; type="text/html"
Link: </public-communities/{community_id}>; rel="alternate"; type="application/json"
Link: </communities/{community_id}.md>; rel="alternate"; type="text/markdown"
```

Rules:

- public pages should link their structured equivalent when one exists
- structured responses should link their canonical human page when one exists
- links must not advertise protected resources as public alternatives
- member-only pages may link protected structured resources, but those resources must require ordinary Pirate auth

## API Catalog

`/.well-known/api-catalog` should be the top-level machine-readable index of Pirate APIs.

It should link at least:

- public OpenAPI/service description
- authenticated OpenAPI/service description when available
- community structured read entrypoints
- OAuth/OIDC metadata
- MCP server card
- agent skills index

Rules:

- the catalog should be stable enough for agents to cache
- entries should include media type, auth requirements, and human documentation links where available
- the catalog must identify which APIs are public and which require auth

## OpenAPI Service Descriptions

Pirate should publish a public OpenAPI description for agent-readable public routes.

Rules:

- public structured read routes should appear in the public service description
- protected/member-only structured routes should either be in a separate authenticated service description or clearly marked with auth requirements
- routes that exist only as future plans should not be advertised as live public operations
- the OpenAPI description should include response-link schemas so agents can traverse without URL templates

## MCP And WebMCP

MCP discovery is useful, but it must not become the canonical content model in v0.

Rules:

- `/.well-known/mcp/server-card.json` should describe Pirate's MCP endpoint if one exists
- MCP resources and tools should wrap the same structured HTTP policy and visibility rules
- MCP must not expose a broader surface than the structured HTTP API
- WebMCP, where supported, should focus on browser actions and interactive workflows
- WebMCP should not be required for read-only traversal of public community content

Recommended split:

- structured HTTP API: canonical read layer
- markdown negotiation: page text accessibility
- WebMCP: browser interaction layer
- MCP Server Card: discovery metadata
- MCP resources/tools: optional wrapper over the same read layer

## OAuth And Protected Resources

Protected and member-only structured reads should use ordinary Pirate auth.

Rules:

- publish OAuth authorization-server metadata where Pirate auth supports OAuth flows
- publish OAuth protected-resource metadata for same-origin APIs
- member-only structured responses must require authenticated readers that satisfy the same gates as humans
- payment, API keys, or MCP credentials must not bypass community gates in v0
- unauthenticated callers should receive normal auth or eligibility failures, not paid-upgrade hints

## Agent Skills

`/.well-known/agent-skills/index.json` should advertise high-level tasks agents can perform with Pirate.

Candidate v0 skills:

- read a public community
- summarize a public thread
- inspect public community events
- authenticate to read member-only community content
- find structured alternatives for Pirate pages

Rules:

- skills should point to API catalog entries or service descriptions rather than duplicating route contracts
- skills must state auth requirements
- skills must not imply AI training is allowed

## Traversal Links

Every structured community response should include typed traversal links.

Required link relation categories:

- `self`
- `canonical`
- `policy`
- `community`
- `posts`
- `post`
- `top_comments`
- `events`
- `markdown`
- `next`
- `prev`

Rules:

- use only relations that apply to the current resource
- include `next` and `prev` only for paginated collections
- include links as structured response fields and, where practical, as HTTP `Link` headers
- do not require agents to construct URLs from IDs
- do not include links to surfaces disabled by community opt-out, except policy links visible to authorized moderators

Suggested JSON shape:

```json
{
  "links": {
    "self": { "href": "/public-communities/gld_123", "type": "application/json" },
    "canonical": { "href": "/c/example", "type": "text/html" },
    "markdown": { "href": "/c/example.md", "type": "text/markdown" },
    "posts": { "href": "/public-communities/gld_123/posts", "type": "application/json" },
    "events": { "href": "/public-events/gld_123", "type": "application/json" }
  }
}
```

## Opt-Out Discovery Semantics

Community opt-outs should be machine-readable.

Rules:

- if a surface is disabled, omit that surface's data from the response
- include a structured `omitted_surfaces` list naming the disabled surface and reason
- omitted-surface reasons are versioned and may grow; clients should treat unknown reasons as non-fatal unavailable-surface explanations
- do not include traversal links to disabled public surfaces
- do not return 404 for the parent resource when only a child surface is opted out
- return 403 with code `structured_surface_disabled` when a caller directly requests a disabled structured surface
- return 404 only when the resource itself is not visible to the caller
- return 401 when auth is required and missing
- return 403 when auth is present but the caller is not eligible

Suggested omitted-surface shape:

```json
{
  "omitted_surfaces": [
    {
      "surface": "top_comments",
      "reason": "community_opt_out"
    }
  ]
}
```

## Rate Limits And Abuse

Discovery endpoints should be cheap and cacheable.

Rules:

- rate limits must apply to structured read endpoints
- discovery documents may have separate low-cost rate-limit behavior
- platform kill switches may remove structured links from discovery metadata when a surface is disabled globally
- community kill switches should remove or mark the affected community's structured links

## V0 Non-Goals

The v0 discovery layer does not include:

- paid x402 access
- API keys for public reads
- full comment-tree export
- training-data licensing
- MCP-only traversal
- route discovery that reveals private content

## Open Questions

The main open questions are operational:

- exact cache TTLs for discovery documents
- exact public OpenAPI path for implemented-only vs planned operations
- whether markdown URLs should be extension-based, negotiated-only, or both
- whether Agent Skills should be generated from OpenAPI metadata or maintained by hand in v0
