# Market Context Worker Contract

Status: draft

Related:

- [market-context.md](/home/t42/Documents/pirate-v2/specs/domain/market-context.md)
- [turso-data-boundaries.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-data-boundaries.md)
- [../db/README.md](/home/t42/Documents/pirate-v2/db/README.md)

## Purpose

Define the concrete worker contract for Pirate's v1 market-context pipeline.

This doc answers:

- what the worker reads
- when it crawls a page
- how the LLM is called
- what structured JSON it must return
- how provider adapters search and normalize markets
- how candidate markets are scored
- what gets written into community and control-plane databases

This doc is implementation-facing.

It does not redefine the product rules already captured in the domain spec.

## V1 Scope

V1 market context is:

- async
- enrichment-only
- limited to top-level `link` posts
- driven by a platform-owned provider profile
- backed by OpenRouter structured outputs for claim extraction

V1 market context is not:

- a publish gate
- a moderation verdict
- a generalized fact-checking system
- a cross-media OCR/transcript system

## Worker Ownership

### Community Job

The post-scoped worker should be driven by `community_jobs`.

Recommended row values:

- `job_type = market_context_match`
- `subject_type = post`
- `subject_id = post_id`

### Control-Plane Cache

The worker may also read and write the global `claim_market_bindings` cache in the control-plane database.

Reason:

- the same normalized claim may appear across multiple communities
- the cache reduces repeated provider search calls
- per-post attachment state still remains community-local

## End-To-End Flow

Recommended v1 flow:

1. Load post and resolved `market_context_policy`.
2. Check eligibility.
3. Fetch and clean the target page.
4. Build structured extraction input.
5. Call OpenRouter with strict JSON Schema output.
6. If extraction abstains, write `post_market_context.status = no_match`.
7. Check `claim_market_bindings` for fresh reusable bindings.
8. Search provider APIs for unresolved claim candidates not satisfied by cache.
9. Normalize provider market rows into a common shape.
10. Score candidate markets.
11. Attach up to `max_markets_per_post` markets if they clear thresholds.
12. Persist post-local attachment rows and refresh global bindings.

## Eligibility Rules

The worker should exit early with `no_match` when any of these are true:

- post is not top-level
- post `post_type != link`
- post has no `link_url`
- community `market_context_policy.mode = off`
- resolved `enabled_post_types` does not include `link`
- post status is not publicly readable

V1 should not enqueue or continue market-context extraction for:

- `text`
- `image`
- `video`
- `song`
- replies

## Crawl Contract

V1 should fetch page content at job time.

Reason:

- the canonical post row does not durably store link-preview text
- headline-only extraction is too weak for reliable claim matching

### Recommended Fetch Strategy

Recommended v1 order:

1. fetch the canonical URL with a readability-oriented crawler
2. fall back to simpler metadata extraction when full-page fetch fails
3. resolve to `no_match` when too little text is available

Pragmatic v1 recommendation:

- primary fetcher: Jina Reader or equivalent cleaned-reader endpoint
- fallback fetcher: Firecrawl or equivalent richer scrape service if Jina-style fetch fails or quality is insufficient

The worker contract does not require one vendor. It requires this normalized fetch result:

```ts
type FetchedPage = {
  final_url: string;
  canonical_url: string | null;
  http_status: number | null;
  fetched_at: string;
  title: string | null;
  meta_description: string | null;
  byline: string | null;
  published_at: string | null;
  site_name: string | null;
  content_markdown: string | null;
  content_text: string | null;
  excerpt: string | null;
  language: string | null;
  failure_code:
    | null
    | "network_error"
    | "timeout"
    | "blocked"
    | "unsupported_content"
    | "empty_content";
};
```

### Text Budget

The worker should not send an entire long article to the model.

Recommended extraction input budget:

- title
- meta description if available
- first meaningful excerpt
- cleaned text truncated to a platform-managed maximum

Suggested v1 maximum:

- 8,000 to 12,000 characters of cleaned text

## OpenRouter Extraction Contract

### Goal

The LLM extracts claim candidates only.

It does not:

- search provider APIs
- select final markets
- decide truth
- decide moderation

### Structured Outputs

Use OpenRouter `response_format.type = json_schema` with `strict = true`.

Implementation requirements:

- model must support structured outputs
- set `require_parameters = true` in OpenRouter routing or provider preferences so the request fails fast if the selected model does not support structured outputs
- provider routing should require structured-output support
- model response should be rejected if it does not validate against the schema

### Recommended V1 Model Class

Use a low-cost structured-output model class.

Examples:

- Gemini flash-lite class
- GPT nano or mini class

The exact model name should remain an environment-configured runtime choice, not a contract constant.

## Extraction Input

Suggested model input object:

```ts
type ClaimExtractionInput = {
  post_id: string;
  post_title: string | null;
  link_url: string;
  fetched_page: {
    final_url: string;
    canonical_url: string | null;
    title: string | null;
    meta_description: string | null;
    published_at: string | null;
    site_name: string | null;
    excerpt: string | null;
    content_text: string | null;
  };
};
```

Input fallback rule:

- the worker should prefer `fetched_page.content_text`
- if `content_text` is null but `content_markdown` exists, the worker should strip markdown formatting and use that derived plain text instead
- if both are effectively empty, the worker should resolve to `no_match`

### Prompt

Recommended system prompt:

```text
You extract externally resolvable claim candidates from a link post for market-context matching.

Return only JSON matching the provided schema.

Rules:
- Extract only discrete, time-bounded, externally resolvable claims.
- Prefer abstention over weak guesses.
- If the content is broad framing, ideology, opinion, outrage bait, or propaganda without a concrete resolvable claim, return should_attach=false.
- Do not judge whether the claim is true.
- Do not search for markets.
- Do not invent dates, entities, or thresholds that are not reasonably implied by the source.
- Normalize claims into short, provider-search-friendly language.
- When multiple concrete claims exist, return up to 3 ordered by relevance to the post.
```

Recommended user prompt template:

```text
Extract market-matchable claim candidates from this post and linked page.

Post title:
{{post_title}}

Link URL:
{{link_url}}

Fetched page title:
{{page_title}}

Meta description:
{{meta_description}}

Published at:
{{published_at}}

Excerpt:
{{excerpt}}

Cleaned page text:
{{content_text}}
```

## Extraction JSON Schema

Recommended strict schema:

```json
{
  "name": "market_context_claim_extraction",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["should_attach", "confidence", "reason", "claim_candidates"],
    "properties": {
      "should_attach": {
        "type": "boolean",
        "description": "Whether the content contains at least one concrete claim worth searching against prediction-market providers."
      },
      "confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "description": "Model confidence in the abstain-vs-attach judgment."
      },
      "reason": {
        "type": "string",
        "enum": [
          "clear_resolvable_claim",
          "multiple_resolvable_claims",
          "too_vague",
          "opinion_or_analysis",
          "propaganda_or_framing_without_claim",
          "insufficient_source_text",
          "non_news_content"
        ]
      },
      "claim_candidates": {
        "type": "array",
        "maxItems": 3,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "claim_text",
            "normalized_claim_text",
            "claim_type",
            "entities",
            "timeframe"
          ],
          "properties": {
            "claim_text": {
              "type": "string",
              "description": "Natural-language claim stated as directly as possible."
            },
            "normalized_claim_text": {
              "type": "string",
              "description": "Short search-oriented normalized claim."
            },
            "claim_type": {
              "type": "string",
              "enum": [
                "election",
                "legislation",
                "macro",
                "company_milestone",
                "asset_price",
                "sports",
                "court_case",
                "policy",
                "other"
              ]
            },
            "entities": {
              "type": "array",
              "items": { "type": "string" }
            },
            "timeframe": {
              "type": "object",
              "additionalProperties": false,
              "required": ["kind", "label"],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["explicit_date", "date_range", "event_window", "none"]
                },
                "label": {
                  "type": "string"
                },
                "start_at": {
                  "type": ["string", "null"],
                  "format": "date-time",
                  "default": null
                },
                "end_at": {
                  "type": ["string", "null"],
                  "format": "date-time",
                  "default": null
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Extraction Thresholds

These are platform-managed, not community-managed, in v1.

Recommended initial thresholds:

- minimum extraction confidence to continue provider search: `0.55`
- if `should_attach = false`, stop immediately regardless of confidence
- if the fetched page has fewer than `500` meaningful characters after cleaning, resolve to `no_match`

These are starting values, not public API guarantees.

## Provider Adapter Contract

Every provider adapter should normalize to the same interface.

```ts
type ProviderMarketSearchInput = {
  claim_candidate: {
    normalized_claim_text: string;
    claim_type: string;
    entities: string[];
    timeframe: {
      kind: "explicit_date" | "date_range" | "event_window" | "none";
      label: string;
      start_at?: string | null;
      end_at?: string | null;
    };
  };
  max_results: number;
};

type NormalizedMarketCandidate = {
  provider_key: string;
  provider_market_id: string;
  provider_event_id: string | null;
  question: string;
  market_url: string;
  outcome_yes_price: string;
  liquidity_score: number | null;
  resolve_date: string | null;
  provider_status: "open" | "closed" | "resolved" | "unknown";
  raw_payload_ref: string | null;
};

interface MarketContextProviderAdapter {
  provider_key: string;
  searchMarkets(input: ProviderMarketSearchInput): Promise<NormalizedMarketCandidate[]>;
}
```

### Normalization Rules

All adapters must:

- normalize `outcome_yes_price` to a decimal string in `[0, 1]`
- preserve provider IDs
- preserve or derive a resolve date when available
- return market URLs suitable for read-only display
- label provider status when known

V1 storage note:

- `provider_status` is adapter output only in v1 and does not require its own persisted post-market column
- v1 read surfaces should rely on `resolve_date` plus `snapshot_at` as the visible freshness signal
- later versions may persist and expose explicit provider settlement state when Pirate needs differentiated rendering for resolved markets

Private evidence note:

- `raw_payload_ref` should be written only into private evidence stores such as `matching_evidence_json` or control-plane cache payloads
- `raw_payload_ref` must not be surfaced on public read models

### V1 Providers

Recommended default-profile adapters:

- `kalshi`
- `polymarket`

The worker may later support additional adapters behind non-default approved profiles.

## Cache Lookup Contract

Before calling provider adapters, the worker should look up fresh global bindings by normalized claim hash.

Suggested claim hash input:

- normalized claim text
- normalized timeframe label or window
- top entities

Suggested freshness rule:

- if a binding snapshot is fresh enough under a platform-managed TTL, reuse it
- otherwise search providers and update the binding

Suggested starting TTL:

- 15 minutes for open markets
- 24 hours for closed markets
- resolved markets may use a longer window or no expiry because their settlement outcome no longer changes

## Scoring Formula

The worker, not the LLM, selects final attached markets.

Recommended v1 score:

```text
final_score =
  0.45 * semantic_similarity +
  0.20 * timeframe_fit +
  0.15 * entity_overlap +
  0.10 * source_specificity +
  0.10 * provider_quality
```

Suggested component meanings:

- `semantic_similarity`
  Similarity between normalized claim text and normalized market question.
- `timeframe_fit`
  Alignment between extracted timeframe and provider resolve date / event window.
- `entity_overlap`
  Overlap between extracted entities and entities visible in the market question.
- `source_specificity`
  Whether the source article describes one concrete claim rather than a diffuse narrative.
- `provider_quality`
  Platform-managed heuristic using factors such as provider trust and market usefulness.

Implementation note:

- v1 may compute `semantic_similarity` with a small embedding model or a platform-managed normalized token-overlap similarity function
- the exact implementation is platform-managed and not part of the public contract

### Hard Filters

Apply these before final ranking:

- reject markets whose question is obviously about a different entity
- reject markets whose resolve date clearly conflicts with the extracted timeframe
- reject duplicate provider market IDs
- reject candidates below a platform-managed minimum semantic-similarity floor

Recommended starting hard floors:

- minimum semantic similarity: `0.70`
- minimum final score for attachment: `0.72`

### Selection Rules

- rank candidates by `final_score`
- dedupe near-identical markets from the same provider
- attach at most `max_markets_per_post`
- if no candidate clears the threshold, resolve to `no_match`

## Job Payload

Recommended `community_jobs.payload_json` shape:

```json
{
  "post_id": "pst_01...",
  "community_id": "gld_01...",
  "attempt_reason": "post_create",
  "link_url": "https://example.com/story",
  "policy_snapshot": {
    "mode": "on",
    "enabled_post_types": ["link"],
    "max_markets_per_post": 2,
    "provider_set": "platform_default",
    "market_context_profile_id": null
  }
}
```

Allowed `attempt_reason` values:

- `post_create`
- `manual_retry`
- `refresh`

## Job Result

Recommended `community_jobs.result_ref` target payload:

```json
{
  "post_market_context_id": "pmc_01...",
  "status": "attached",
  "claim_summary": "Will the Senate pass the bill by the stated deadline?",
  "attached_market_count": 2,
  "used_cache": true,
  "provider_keys": ["kalshi", "polymarket"],
  "snapshot_at": "2026-04-10T12:00:00Z"
}
```

Possible result statuses:

- `attached`
- `no_match`
- `detached`

`detached` should normally be written by moderation or policy-driven follow-up work rather than the first-pass match worker.

## Write Contract

### When Attached

On success:

1. upsert `post_market_contexts`
2. set `status = attached`
3. write `claim_summary`
4. write `matching_evidence_json`
5. upsert `post_market_context_markets`
6. refresh `claim_market_bindings`

### When No Match

On abstention or failed search:

1. upsert `post_market_contexts`
2. set `status = no_match`
3. clear or omit public market rows
4. keep private evidence only if useful for audit/debug

## Failure Handling

The worker should distinguish between:

- ordinary abstention
- temporary operational failure

Recommended handling:

- extraction says `should_attach = false` -> succeed job, write `no_match`
- fetch timeout or provider timeout -> fail job for retry
- malformed provider response -> fail job for retry
- permanent unsupported URL or empty source -> succeed job, write `no_match`

## Logging And Audit

Store enough private evidence to debug bad matches without exposing that evidence to clients.

Recommended private evidence bundle:

- crawl metadata
- truncated extraction input hash
- extraction output JSON
- provider search queries
- scored candidate list
- final attachment decision

This evidence belongs in private storage such as `matching_evidence_json` and control-plane cache payloads, not in public read models.

## Defaults

Recommended v1 defaults:

- market context enabled by default
- eligible post types: `['link']`
- max attached markets: `2`
- default provider profile: `kalshi + polymarket`
- extraction model: cheap structured-output model class
- crawl at job time
- prefer abstention over weak match

## Non-Goals

Do not add these in v1:

- OCR-based image claim extraction
- transcript-based video claim extraction
- per-community prompt tuning
- per-community confidence thresholds
- automatic feed-ranking changes based on market prices
- automatic moderation actions based on market prices
