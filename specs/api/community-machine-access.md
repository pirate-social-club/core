# Community Machine Access API

Status: draft

Related docs:

- [../domain/community-machine-access.md](../domain/community-machine-access.md)
- [../domain/community-money-policy.md](../domain/community-money-policy.md)
- [../domain/community-pricing-policy.md](../domain/community-pricing-policy.md)
- [../domain/monetization.md](../domain/monetization.md)
- [README.md](./README.md)

## Purpose

This doc sketches the API surface for community-controlled machine data access, data licenses, and x402 payment.

It is separate from the domain policy spec because endpoint shape and payment protocol details will change faster than community policy semantics.

## Naming

Use `machine_access_*`, `external_reader_*`, and `data_license_*` names.

Do not use `agent_*` for these endpoints or schemas. In Pirate APIs, `agent_*` already refers to KYA-backed user-owned agents that can act on behalf of verified humans.

## Endpoint Groups

Recommended planned endpoints:

```http
GET   /communities/{community_id}/machine-access-policy
PATCH /communities/{community_id}/machine-access-policy
GET   /public-communities/{community_id}/machine-metadata
GET   /communities/{community_id}/data-license
POST  /communities/{community_id}/data-license/quote
GET   /communities/{community_id}/data/feed
GET   /communities/{community_id}/data/archive
```

Implementation should start with the policy read/write endpoint and Storybook UI before adding paid data routes.

## Policy Read And Write

`GET /communities/{community_id}/machine-access-policy`

Returns the resolved effective policy, including `policy_origin`.

When no explicit policy exists, the server must return a default resolved policy rather than null.

`PATCH /communities/{community_id}/machine-access-policy`

Stores an explicit community policy.

Rules:

- moderator authorization is required
- changes apply prospectively
- response returns the resolved policy after persistence
- server validates that paid modes have viable pricing and settlement configuration before exposing paid data routes

## Public Machine Metadata

`GET /public-communities/{community_id}/machine-metadata`

Returns the unpaid machine-readable discovery payload allowed by the community's current policy.

Behavior:

- `machine_discovery = hidden`: return `404` or a minimal non-indexable response, according to platform policy
- `machine_discovery = metadata_only`: return community metadata and coarse counts
- `machine_discovery = preview`: return metadata plus limited post previews

This endpoint must not return full post bodies, raw vote scores, per-user state, membership graphs, ranking internals, moderation signals, or anti-abuse signals.

## License Endpoint

`GET /communities/{community_id}/data-license`

Returns the current machine-readable license terms for external readers.

Suggested response:

```json
{
  "community_id": "gld_123",
  "policy_origin": "explicit",
  "machine_discovery": "metadata_only",
  "machine_structured_access": "paid",
  "machine_indexing": "metadata",
  "allowed_uses": {
    "search_indexing": false,
    "summarization": true,
    "analytics": true,
    "commercial_use": "paid_license",
    "ai_training": "prohibited",
    "resale": false
  },
  "settlement": {
    "mode": "platform_default",
    "settlement_destination": "platform_ops_wallet"
  },
  "terms_url": "https://pirate.sc/terms",
  "updated_at": "2026-04-23T00:00:00.000Z"
}
```

This response is part of the contractual layer. It should be linked from paid responses and 402 challenges.

## Quote Endpoint

`POST /communities/{community_id}/data-license/quote`

Creates a quote for a structured read, archive export, or other machine-access product.

Suggested request:

```json
{
  "product": "feed_page",
  "requested_uses": ["analytics", "summarization"],
  "format": "json",
  "limit": 100
}
```

Suggested response:

```json
{
  "quote_id": "dlq_123",
  "community_id": "gld_123",
  "product": "feed_page",
  "price": {
    "amount_usd": "0.10",
    "settlement_token": "USDC",
    "settlement_chain": {
      "namespace": "eip155",
      "reference": "8453"
    }
  },
  "allowed_uses": {
    "analytics": true,
    "summarization": true,
    "ai_training": "prohibited"
  },
  "expires_at": "2026-04-23T00:10:00.000Z"
}
```

Pricing amounts are data-access product policy. Funding lanes, routing constraints, and settlement chain/token constraints should reuse the active community money policy where possible.

In `platform_default`, the settlement destination may be Pirate's platform ops wallet. In `club_override` and `governance_controlled`, the destination should be the configured community treasury or governance-backed settlement destination.

## Paid Data Routes

`GET /communities/{community_id}/data/feed`

Returns a paid structured feed page.

`GET /communities/{community_id}/data/archive`

Returns a paid archive export or starts an export job.

Rules:

- paid routes require x402 payment or another explicit paid-access credential
- paid routes must attach or expose the data-license snapshot used for the response
- successful responses should include receipt metadata sufficient for audit
- paid routes must still enforce ordinary viewing gates, age gates, safety takedowns, and moderation state
- paid routes do not grant AI training rights unless the license snapshot explicitly grants them

## x402 Flow

When payment is required:

```http
HTTP/1.1 402 Payment Required
Link: </communities/gld_123/data-license>; rel="license"
Payment-Required: ...
Content-Type: application/json
```

The 402 body should include:

- `code`
- `message`
- `license_url`
- `quote_id` if prequoted
- requested product
- allowed uses
- prohibited uses

After successful payment:

```http
HTTP/1.1 200 OK
Payment-Response: ...
Link: </communities/gld_123/data-license>; rel="license"
Content-Type: application/json
```

The response body should include:

- requested data
- `data_license_snapshot`
- `payment_receipt_ref`
- `allowed_uses`
- explicit `ai_training` value

## Enforcement Limits

Pirate can enforce access, payment, rate limits, field inclusion, and client revocation.

Pirate cannot technically guarantee that a downstream actor will not train a model after receiving data.

AI-training restrictions are contractual and audit-backed. API responses should expose this as license language, not as a technical guarantee.

## OpenAPI Integration Plan

When implementation begins:

1. Add schemas to `specs/api/src/components/schemas/communities-community.yaml`.
2. Add path items to `specs/api/src/paths/communities.yaml`.
3. Add root path refs to `specs/api/src/openapi.yaml`.
4. Mark operations `x-implemented: false` until the worker routes are live.
5. Run `rtk bun specs/api/scripts/verify-openapi.ts`.

