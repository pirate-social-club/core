# Global Handle Settings Release Monitoring

Status: active release follow-up

Owner: API operations

## Scope

Monitor production requests from the global-handle settings flow for three consecutive complete UTC
days after the release of web revision `607d4b430c5c9be1fad5429993ee4e0bc8950c07`.

Routes:

- `POST /profiles/me/quote-handle-upgrade`
- `POST /profiles/me/rename-global-handle`
- `POST /profiles/me/global-handle/claim` for paid replacements

## Sources Of Truth

- Cloudflare Worker observability is authoritative for request counts grouped by route, method, status,
  environment, and deployment revision
- Sentry is the drill-down source for unexpected 5xx exceptions and request correlation
- Tinybird `handle_claim_started`, `handle_claim_failed`, and `handle_claim_succeeded` events are
  supporting product signals; they are not a complete HTTP status ledger

## Access Preflight

Before the first checkpoint, the operator must have one of:

- an authenticated Cloudflare dashboard session with access to Workers Observability Query Builder
- an API token accepted by
  `POST /accounts/{account_id}/workers/observability/telemetry/query` with the Cloudflare-documented
  `Workers Observability Write` permission

`wrangler tail` and a token limited to `workers_tail` are not sufficient: they expose only live events,
not a completed UTC window. The local Wrangler OAuth credential was verified on 2026-07-18 to lack
historical telemetry-query access (`403`). Resolve dashboard/API access before counting a checkpoint.

References:

- [Workers Observability Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)
- [Workers Observability telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)

## Historical Query Procedure

Set the Query Builder timeframe to the exact half-open UTC window `[00:00:00Z, next 00:00:00Z)` and
select the production API Worker service (`api-core`). Query invocation events, not only custom logs.

Use the indexed invocation metadata fields `$metadata.url`, `$metadata.trigger`, and
`$metadata.statusCode`. Discover/confirm them through the Query Builder autocomplete or telemetry keys
endpoint before the first recorded run; do not guess a renamed field.

Base route filter:

```text
$metadata.service = "api-core" AND (
  contains($metadata.url, "/profiles/me/quote-handle-upgrade") OR
  contains($metadata.url, "/profiles/me/rename-global-handle") OR
  contains($metadata.url, "/profiles/me/global-handle/claim")
)
```

Error-only refinement:

```text
$metadata.statusCode >= 400
```

Calculate invocation count grouped by `$metadata.trigger` and `$metadata.statusCode`. Export or record
the grouped result with the exact timeframe, query text, Worker revision, and sampling interval. If
sampling is active, use Cloudflare's reported aggregate count/sample interval rather than treating the
number of returned event rows as the request total.

For each 5xx group, open representative invocation events and correlate their request or trace
identifier with Sentry. For each quote-route `400`, inspect correlation metadata and reproduce with a
current production client; invocation logs intentionally do not require storing the desired label or
other request-body data.

## Classification

Report separately:

- expected availability outcomes returned as successful quote responses; these are not errors
- authentication failures (`401`/`403`)
- malformed or invalid client requests (`400`/`422`)
- conflict or stale-quote responses (`409`/`410`, where applicable)
- rate limiting (`429`)
- server failures (`5xx`)

The original regression signal is a `400` caused by entering the already-active handle. Any recurrence
from the settings surface is a release regression, not baseline noise.

## Checkpoints And Finish Condition

Evaluate three complete UTC-day windows. At each checkpoint record per route:

- total requests
- count and rate for each classified status family
- comparison with the preceding available baseline
- linked Sentry issue or request identifier for every 5xx class
- whether any active-handle quote produced a client error

Scheduled checkpoints for this release:

- 2026-07-20: evaluate the complete 2026-07-19 UTC window
- 2026-07-21: evaluate the complete 2026-07-20 UTC window
- 2026-07-22: evaluate the complete 2026-07-21 UTC window and close if all conditions pass

Close this follow-up after **three consecutive complete UTC days** when:

1. no active-handle/current-name regression is observed
2. quote and rename 4xx rates are at or below the preceding baseline after expected outcomes are excluded
3. there is no new persistent 5xx class attributable to the release

If traffic is zero for a route on a day, record `no traffic`; do not count that day as evidence of a
stable rate. Extend only until three observed-traffic days are available, with a seven-calendar-day
maximum before an explicit owner review.

## Escalation

- any reproduced current-name `400`: reopen the settings fix immediately
- any new persistent 5xx class: halt related rollout work and assign the Sentry issue
- elevated 4xx without a reproduced client defect: inspect request payload/version mix before changing
  server eligibility policy
