# Analytics Event Contract

Tinybird is the analytics plane only. Neon (control-plane + per-community DBs) remains the
authoritative source of truth. Events stream into Tinybird for funnels, conversion, retention,
and community health.

## Principles

1. Typed event contract — no untyped dump of random frontend actions.
2. Server-authoritative events fire only after a successful mutation.
3. Client events signal intent/dropoff, not conversion.
4. No PII in Tinybird. Identity uses `user_id_hash = HMAC(user_id)`.
5. Every event is dedupable by `event_id`.
6. Backfilled events carry `source: backfill` and never mix with live without that dimension.

## Ingestion boundary

- **Web → pirate-api → Tinybird.** The browser never holds a Tinybird token.
- **API** validates, strips PII, assigns `event_id`, enriches with context.
- **Critical server events** go through a durable outbox (control-plane DB) before Tinybird.
- **Background worker** drains the outbox in batches to the Tinybird Events API.

## Raw source schema

All events land in `analytics_events_raw`:

| Column                    | Type       | Description                                         |
|---------------------------|------------|-----------------------------------------------------|
| `event_id`                | String     | Globally unique, dedup key                          |
| `event_name`              | String     | Contract name from the lists below                  |
| `event_version`           | UInt8      | Schema version for this event_name                  |
| `event_time`              | DateTime64(3) | When the event logically occurred                 |
| `received_at`             | DateTime64(3) | When Tinybird received it                         |
| `environment`             | String     | `development` \| `staging` \| `production`          |
| `source`                  | String     | `web` \| `api` \| `job` \| `backfill`               |
| `app_surface`             | String     | `web` \| `api` \| `worker`                          |
| `session_id`              | String     | Client session UUID                                 |
| `anonymous_id`            | String     | Pre-auth anonymous identity                         |
| `user_id_hash`            | String     | HMAC-SHA256(user_id), never raw user_id             |
| `community_id`            | String     | Empty when not scoped to a community                |
| `post_id`                 | String     | Empty when not scoped to a post                     |
| `comment_id`              | String     | Empty when not scoped to a comment                  |
| `listing_id`              | String     | Empty when not scoped to a listing                  |
| `quote_id`                | String     | Empty when not scoped to a quote                    |
| `purchase_id`             | String     | Empty when not scoped to a purchase                 |
| `verification_session_id` | String     | Empty when not scoped to a verification session     |
| `request_id`              | String     | Empty when not linked to an API request             |
| `idempotency_key`         | String     | Empty when no client-provided dedup key exists      |
| `properties_json`         | String     | JSON-encoded event-specific properties              |

Optional string dimensions are stored as empty strings in Tinybird instead of nullable columns. This
keeps ingestion tolerant of client and job events that do not have community, content, commerce, or
verification context.

## PII rules

**Never send:**
- Reddit usernames
- Wallet addresses
- Auth provider subjects
- IP addresses
- Tokens or secrets
- Full User-Agent strings
- Raw verification payloads
- Profile text or bio content

**Identity:**
- Use `user_id_hash = HMAC-SHA256(user_id, secret)`.
- Any user_id to user_id_hash lookup table stays only in Neon if ever needed.
- Pre-auth: use `anonymous_id` (random UUID persisted in localStorage).

## Event definitions

### Onboarding / Conversion

| Event                                      | Source type          | Owner          | Ver |
|--------------------------------------------|----------------------|----------------|-----|
| `page_viewed`                              | client               | pirate-web     | 1   |
| `auth_started`                             | client               | pirate-web     | 1   |
| `auth_session_exchanged`                   | server_authoritative | pirate-api     | 1   |
| `unique_human_verification_started`        | client               | pirate-web     | 1   |
| `unique_human_verification_succeeded`      | server_authoritative | pirate-api     | 1   |
| `unique_human_verification_failed`         | server_authoritative | pirate-api     | 1   |
| `reddit_verification_started`              | client               | pirate-web     | 1   |
| `reddit_verification_code_generated`       | server_authoritative | pirate-api     | 1   |
| `reddit_verification_succeeded`            | server_authoritative | pirate-api     | 1   |
| `reddit_verification_failed`               | server_authoritative | pirate-api     | 1   |
| `reddit_import_queued`                     | server_authoritative | pirate-api     | 1   |
| `reddit_import_started`                    | server_authoritative | pirate-api     | 1   |
| `reddit_import_succeeded`                  | server_authoritative | pirate-api     | 1   |
| `reddit_import_failed`                     | server_authoritative | pirate-api     | 1   |
| `handle_claim_started`                     | client               | pirate-web     | 1   |
| `handle_claim_succeeded`                   | server_authoritative | pirate-api     | 1   |
| `onboarding_completed`                     | server_authoritative | pirate-api     | 1   |
| `onboarding_skipped`                       | server_authoritative | pirate-api     | 1   |

### Activation

| Event                    | Source type          | Owner          | Ver |
|--------------------------|----------------------|----------------|-----|
| `home_feed_viewed`       | client               | pirate-web     | 1   |
| `community_viewed`       | client               | pirate-web     | 1   |
| `community_followed`     | server_authoritative | pirate-api     | 1   |
| `community_join_requested` | client             | pirate-web     | 1   |
| `community_join_succeeded` | server_authoritative | pirate-api     | 1   |
| `post_composer_opened`   | client               | pirate-web     | 1   |
| `post_created`           | server_authoritative | pirate-api     | 1   |
| `comment_created`        | server_authoritative | pirate-api     | 1   |
| `post_voted`             | server_authoritative | pirate-api     | 1   |
| `comment_voted`          | server_authoritative | pirate-api     | 1   |
| `thread_viewed`          | client               | pirate-web     | 1   |

### Community Creation

| Event                                    | Source type          | Owner      | Ver |
|------------------------------------------|----------------------|------------|-----|
| `community_create_started`               | client               | pirate-web | 1   |
| `community_create_submitted`             | server_authoritative | pirate-api | 1   |
| `namespace_verification_started`         | server_authoritative | pirate-api | 1   |
| `namespace_verification_succeeded`       | server_authoritative | pirate-api | 1   |
| `namespace_verification_failed`          | server_authoritative | pirate-api | 1   |
| `community_provisioning_requested`       | server_authoritative | pirate-api | 1   |
| `community_provisioning_succeeded`       | job_authoritative    | job worker | 1   |
| `community_provisioning_failed`          | job_authoritative    | job worker | 1   |
| `registry_publication_succeeded`         | server_authoritative | pirate-api | 1   |
| `registry_publication_failed`            | server_authoritative | pirate-api | 1   |

### Commerce

| Event                        | Source type          | Owner          | Ver |
|------------------------------|----------------------|----------------|-----|
| `listing_viewed`             | client               | pirate-web     | 1   |
| `purchase_quote_requested`   | client               | pirate-web     | 1   |
| `purchase_quote_created`     | server_authoritative | pirate-api     | 1   |
| `purchase_quote_failed`      | server_authoritative | pirate-api     | 1   |
| `checkout_started`           | client               | pirate-web     | 1   |
| `funding_route_selected`     | client               | pirate-web     | 1   |
| `purchase_submitted`         | server_authoritative | pirate-api     | 1   |
| `purchase_confirmed`         | server_authoritative | pirate-api     | 1   |
| `purchase_failed`            | server_authoritative | pirate-api     | 1   |
| `entitlement_granted`        | server_authoritative | pirate-api     | 1   |
| `asset_accessed`             | client               | pirate-web     | 1   |
| `donation_selected`          | client               | pirate-web     | 1   |

### Trust / Moderation

| Event                        | Source type          | Owner          | Ver |
|------------------------------|----------------------|----------------|-----|
| `gate_check_failed`          | server_authoritative | pirate-api     | 1   |
| `report_submitted`           | server_authoritative | pirate-api     | 1   |
| `moderation_case_opened`     | server_authoritative | pirate-api     | 1   |
| `moderation_action_taken`    | server_authoritative | pirate-api     | 1   |
| `moderation_action_reversed` | server_authoritative | pirate-api     | 1   |

### Notifications

| Event                       | Source type          | Owner      | Ver |
|-----------------------------|----------------------|------------|-----|
| `notification_generated`    | server_authoritative | pirate-api | 1   |
| `notification_inbox_viewed` | client               | pirate-web | 1   |
| `notification_opened`       | client               | pirate-web | 1   |
| `notification_marked_read`  | client + server_authoritative | pirate-web + pirate-api | 1   |
| `notification_task_dismissed` | server_authoritative | pirate-api | 1   |

### PWA Install

| Event                          | Source type | Owner      | Ver |
|--------------------------------|-------------|------------|-----|
| `pwa_install_promo_viewed`     | client      | pirate-web | 1   |
| `pwa_install_prompt_opened`    | client      | pirate-web | 1   |
| `pwa_install_prompt_accepted`  | client      | pirate-web | 1   |
| `pwa_install_prompt_dismissed` | client      | pirate-web | 1   |
| `pwa_install_promo_dismissed`  | client      | pirate-web | 1   |
| `pwa_installed`                | client      | pirate-web | 1   |

## Per-event properties

Events carry additional context in `properties_json`. Key property schemas:

### pwa_install_promo_viewed (v1)
```json
{
  "surface": "inbox" | "settings" | "snackbar",
  "trigger": "unread_count" | "manual",
  "unread_count_bucket": "0" | "1" | "2_5" | "6_20" | "20_plus"
}
```

### pwa_install_prompt_opened (v1)
```json
{
  "surface": "inbox" | "settings" | "snackbar",
  "platform": "chromium" | "ios_manual"
}
```

### pwa_install_prompt_accepted / pwa_install_prompt_dismissed / pwa_installed (v1)
```json
{
  "surface": "inbox" | "settings" | "snackbar"
}
```

### pwa_install_promo_dismissed (v1)
```json
{
  "surface": "inbox" | "settings" | "snackbar",
  "dismiss_reason": "not_now" | "close" | "native_dismissed" | "dont_show_again"
}
```

### page_viewed (v1)
```json
{
  "pathname": "/",
  "referrer_host": "example.com",
  "utm_source": "string",
  "utm_campaign": "string"
}
```

### auth_started (v1)
```json
{
  "provider": "privy" | "jwt_based_auth"
}
```

### unique_human_verification_failed (v1)
```json
{
  "provider": "self" | "very",
  "failure_code": "expired" | "invalid_proof" | "provider_error" | "unknown",
  "provider_error_code": "string",
  "attempt_number": 1,
  "latency_ms": 1234
}
```

### reddit_verification_failed (v1)
```json
{
  "failure_code": "code_not_found" | "username_not_found" | "rate_limited" | "source_error" | "unknown"
}
```

### reddit_import_failed (v1)
```json
{
  "failure_code": "snapshot_error" | "timeout" | "unknown"
}
```

### reddit_import_succeeded (v1)
```json
{
  "imported_reddit_score_bucket": "unknown" | "under_1k" | "1k_10k" | "10k_50k" | "50k_100k" | "100k_plus",
  "top_subreddit_count": 3,
  "suggested_community_count": 0,
  "has_imported_reddit_score": true
}
```

### handle_claim_succeeded (v1)
```json
{
  "source": "free_cleanup_rename" | "verified_reddit_username" | "reddit_verified_claim" | "paid_upgrade" | "admin_grant",
  "tier": "generated" | "standard" | "premium",
  "handle_length": 7,
  "shorter_by": 1
}
```

### community_provisioning_failed (v1)
```json
{
  "failure_code": "operator_error" | "timeout" | "db_init_error" | "unknown"
}
```

### purchase_failed (v1)
```json
{
  "failure_code": "insufficient_funds" | "tx_reverted" | "settlement_error" | "unknown"
}
```

### gate_check_failed (v1)
```json
{
  "gate_type": "verification" | "membership" | "age" | "location",
  "failure_code": "not_verified" | "not_member" | "restricted" | "unknown"
}
```

### home_feed_viewed (v1)
```json
{
  "sort": "latest" | "hot" | "top",
  "page_depth": 0
}
```

### community_viewed (v1)
```json
{
  "tab": "posts" | "listings" | "about"
}
```

### purchase_quote_created (v1)
```json
{
  "funding_destination": "onchain" | "offchain",
  "asset_count": 1
}
```

### notification_generated (v1)
```json
{
  "notification_kind": "task" | "activity",
  "notification_type": "namespace_verification_required" | "membership_review" | "comment_reply" | "post_commented" | "royalty_earned",
  "task_type": "namespace_verification_required" | "membership_review" | null,
  "task_persistence": "persisted" | null
}
```

### notification_opened (v1)
```json
{
  "notification_kind": "task" | "activity",
  "notification_type": "comment_reply" | "post_commented" | null,
  "task_type": "unique_human_verification_required" | "profile_completion_suggested" | "global_handle_cleanup_suggested" | "namespace_verification_required" | "membership_review" | null,
  "task_persistence": "synthetic" | "persisted" | null,
  "open_surface": "inbox",
  "task_auto_cleared_on_open": true
}
```

### notification_marked_read (v1)
```json
{
  "notification_kind": "activity",
  "notification_type": "comment_reply" | "post_commented" | "royalty_earned",
  "read_mode": "auto_visible_load" | "explicit_ids" | "mark_all",
  "open_surface": "inbox",
  "count": 2
}
```

### notification_task_dismissed (v1)
```json
{
  "notification_kind": "task",
  "task_type": "namespace_verification_required" | "membership_review" | "profile_completion_suggested" | "global_handle_cleanup_suggested",
  "task_persistence": "persisted",
  "dismiss_surface": "inbox"
}
```

## Versioning

- `event_version` starts at 1 for every event.
- Bump version when adding required properties or changing existing property semantics.
- Adding optional properties does not require a version bump.
- Consumers must filter by `event_version` when querying specific schema versions.

## Tinybird data model

The Tinybird project keeps one raw append-only source and derived materialized datasources. These
resources are defined in `lib/tinybird.ts`.

| Resource | Purpose |
|------|---------|
| `analytics_events_raw` | Raw NDJSON ingest source. |
| `events_hourly_mv` | Hourly event rollups for volume and quality dashboards. |
| `onboarding_steps_mv` | Narrow row-level onboarding events for funnel endpoints. |
| `activation_events_mv` | Narrow row-level activation events for cohort endpoints. |
| `notification_events_mv` | Narrow row-level notification lifecycle events for inbox funnel endpoints. |
| `community_health_daily_mv` | Daily community activity rollups. |
| `commerce_funnel_daily_mv` | Daily commerce funnel rollups. |
| `import_quality_daily_mv` | Daily Reddit verification/import rollups. |

Materialized views write to those destination datasources.

Published endpoints:

- `conversion_overview`
- `onboarding_funnel`
- `activation_funnel`
- `notification_task_funnel`
- `notification_activity_funnel`
- `community_health`
- `commerce_funnel`
- `retention_cohorts`
- `event_quality`
- `verification_failures`
- `community_import_health`

## Validation

Before wiring more API or web instrumentation, validate this project with the Tinybird SDK CLI. The
root repo is main-only, so `tinybird build` in branch mode is intentionally blocked on `main`; use
`tinybird deploy` for the main workspace or switch to a temporary non-project branch only for branch
preview work.

```bash
rtk infisical run --env dev --path /services/api -- \
  rtk ./node_modules/.bin/tinybird info

rtk infisical run --env dev --path /services/api -- \
  rtk ./node_modules/.bin/tinybird deploy
```

The dev Tinybird workspace is `pirate_dev` in US East:

```text
https://api.us-east.aws.tinybird.co
```

Secrets live in Infisical under `/services/api` for `dev`:

- `TINYBIRD_TOKEN`
- `TINYBIRD_URL`
- `TINYBIRD_INGEST_TOKEN`
- `TINYBIRD_HOST`
- `TINYBIRD_EVENTS_DATASOURCE`
- `ANALYTICS_ENABLED`
- `ANALYTICS_HMAC_SECRET`

The SDK entrypoint is `lib/tinybird.ts`, configured by `tinybird.config.mjs`. This is the only
mainline Tinybird definition surface. Do not add `.datasource` or `.pipe` files under
`analytics/tinybird`; generated Tinybird files should stay outside the repo or in a temporary
directory.

After deployment, ingest `analytics/tinybird/fixtures/analytics_events_raw.ndjson` against
`analytics_events_raw` before testing endpoints.
