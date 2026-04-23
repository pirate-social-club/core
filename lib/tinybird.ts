/**
 * Tinybird analytics definitions.
 *
 * This is the mainline Tinybird definition surface for deployment and the typed
 * SDK client for server-side ingestion and endpoint queries.
 */

import {
  Tinybird,
  defineDatasource,
  defineEndpoint,
  defineMaterializedView,
  engine,
  node,
  p,
  t,
  type InferOutputRow,
  type InferParams,
  type InferRow,
} from "@tinybirdco/sdk"

export const analyticsEventsRaw = defineDatasource("analytics_events_raw", {
  description: "Raw append-only Pirate analytics events.",
  schema: {
    event_id: t.string().jsonPath("$.event_id"),
    event_name: t.string().lowCardinality().jsonPath("$.event_name"),
    event_version: t.uint8().default(1).jsonPath("$.event_version"),
    event_time: t.dateTime64(3, "UTC").jsonPath("$.event_time"),
    received_at: t.dateTime64(3, "UTC").defaultExpr("now64(3)").jsonPath("$.received_at"),
    environment: t.string().lowCardinality().jsonPath("$.environment"),
    source: t.string().lowCardinality().jsonPath("$.source"),
    app_surface: t.string().lowCardinality().jsonPath("$.app_surface"),
    session_id: t.string().default("").jsonPath("$.session_id"),
    anonymous_id: t.string().default("").jsonPath("$.anonymous_id"),
    user_id_hash: t.string().default("").jsonPath("$.user_id_hash"),
    community_id: t.string().default("").jsonPath("$.community_id"),
    post_id: t.string().default("").jsonPath("$.post_id"),
    comment_id: t.string().default("").jsonPath("$.comment_id"),
    listing_id: t.string().default("").jsonPath("$.listing_id"),
    quote_id: t.string().default("").jsonPath("$.quote_id"),
    purchase_id: t.string().default("").jsonPath("$.purchase_id"),
    verification_session_id: t.string().default("").jsonPath("$.verification_session_id"),
    request_id: t.string().default("").jsonPath("$.request_id"),
    idempotency_key: t.string().default("").jsonPath("$.idempotency_key"),
    properties_json: t.string().default("{}").jsonPath("$.properties_json"),
  },
  engine: engine.mergeTree({
    partitionKey: "toYYYYMM(event_time)",
    sortingKey: ["event_time", "event_name", "user_id_hash", "event_id"],
    ttl: "toDateTime(event_time) + toIntervalDay(365)",
  }),
})

export type AnalyticsEventRow = InferRow<typeof analyticsEventsRaw>

export const eventsHourlyMv = defineDatasource("events_hourly_mv", {
  description: "Hourly event volume rollups.",
  jsonPaths: false,
  schema: {
    hour: t.dateTime("UTC"),
    event_name: t.string().lowCardinality(),
    environment: t.string().lowCardinality(),
    source: t.string().lowCardinality(),
    community_id: t.string(),
    event_count: t.simpleAggregateFunction("sum", t.uint64()),
    unique_users_state: t.aggregateFunction("uniq", t.string()),
    unique_sessions_state: t.aggregateFunction("uniq", t.string()),
  },
  engine: engine.aggregatingMergeTree({
    partitionKey: "toYYYYMM(hour)",
    sortingKey: ["hour", "event_name", "environment", "source", "community_id"],
    ttl: "hour + toIntervalDay(365)",
  }),
})

export const onboardingStepsMv = defineDatasource("onboarding_steps_mv", {
  description: "Row-level onboarding steps used by funnel endpoints.",
  jsonPaths: false,
  schema: {
    event_id: t.string(),
    event_time: t.dateTime64(3, "UTC"),
    environment: t.string().lowCardinality(),
    source: t.string().lowCardinality(),
    user_id_hash: t.string(),
    session_id: t.string(),
    step_name: t.string().lowCardinality(),
    step_order: t.uint8(),
    outcome: t.string().lowCardinality(),
  },
  engine: engine.mergeTree({
    partitionKey: "toYYYYMM(event_time)",
    sortingKey: ["environment", "event_time", "step_order", "user_id_hash", "event_id"],
    ttl: "toDateTime(event_time) + toIntervalDay(365)",
  }),
})

export const activationEventsMv = defineDatasource("activation_events_mv", {
  description: "Row-level activation events used by cohort endpoints.",
  jsonPaths: false,
  schema: {
    event_id: t.string(),
    event_time: t.dateTime64(3, "UTC"),
    environment: t.string().lowCardinality(),
    source: t.string().lowCardinality(),
    user_id_hash: t.string(),
    session_id: t.string(),
    community_id: t.string(),
    activation_name: t.string().lowCardinality(),
  },
  engine: engine.mergeTree({
    partitionKey: "toYYYYMM(event_time)",
    sortingKey: ["environment", "event_time", "activation_name", "user_id_hash", "community_id", "event_id"],
    ttl: "toDateTime(event_time) + toIntervalDay(365)",
  }),
})

export const communityHealthDailyMv = defineDatasource("community_health_daily_mv", {
  description: "Daily community activity rollups.",
  jsonPaths: false,
  schema: {
    day: t.date(),
    community_id: t.string(),
    environment: t.string().lowCardinality(),
    total_events: t.simpleAggregateFunction("sum", t.uint64()),
    views: t.simpleAggregateFunction("sum", t.uint64()),
    follows: t.simpleAggregateFunction("sum", t.uint64()),
    posts: t.simpleAggregateFunction("sum", t.uint64()),
    comments: t.simpleAggregateFunction("sum", t.uint64()),
    votes: t.simpleAggregateFunction("sum", t.uint64()),
    active_users_state: t.aggregateFunction("uniq", t.string()),
  },
  engine: engine.aggregatingMergeTree({
    partitionKey: "toYYYYMM(day)",
    sortingKey: ["day", "environment", "community_id"],
    ttl: "day + toIntervalDay(365)",
  }),
})

export const commerceFunnelDailyMv = defineDatasource("commerce_funnel_daily_mv", {
  description: "Daily commerce funnel rollups.",
  jsonPaths: false,
  schema: {
    day: t.date(),
    community_id: t.string(),
    environment: t.string().lowCardinality(),
    quotes_requested: t.simpleAggregateFunction("sum", t.uint64()),
    quotes_created: t.simpleAggregateFunction("sum", t.uint64()),
    checkouts_started: t.simpleAggregateFunction("sum", t.uint64()),
    purchases_submitted: t.simpleAggregateFunction("sum", t.uint64()),
    purchases_confirmed: t.simpleAggregateFunction("sum", t.uint64()),
    purchases_failed: t.simpleAggregateFunction("sum", t.uint64()),
    entitlements_granted: t.simpleAggregateFunction("sum", t.uint64()),
    quote_users_state: t.aggregateFunction("uniq", t.string()),
    purchase_users_state: t.aggregateFunction("uniq", t.string()),
  },
  engine: engine.aggregatingMergeTree({
    partitionKey: "toYYYYMM(day)",
    sortingKey: ["day", "environment", "community_id"],
    ttl: "day + toIntervalDay(365)",
  }),
})

export const importQualityDailyMv = defineDatasource("import_quality_daily_mv", {
  description: "Daily Reddit verification and import quality rollups.",
  jsonPaths: false,
  schema: {
    day: t.date(),
    environment: t.string().lowCardinality(),
    verifications_started: t.simpleAggregateFunction("sum", t.uint64()),
    verifications_succeeded: t.simpleAggregateFunction("sum", t.uint64()),
    verifications_failed: t.simpleAggregateFunction("sum", t.uint64()),
    imports_started: t.simpleAggregateFunction("sum", t.uint64()),
    imports_succeeded: t.simpleAggregateFunction("sum", t.uint64()),
    imports_failed: t.simpleAggregateFunction("sum", t.uint64()),
    unique_users_state: t.aggregateFunction("uniq", t.string()),
  },
  engine: engine.aggregatingMergeTree({
    partitionKey: "toYYYYMM(day)",
    sortingKey: ["day", "environment"],
    ttl: "day + toIntervalDay(365)",
  }),
})

export const mvEventsHourly = defineMaterializedView("mv_events_hourly", {
  datasource: eventsHourlyMv,
  nodes: [
    node({
      name: "materialize_events_hourly",
      sql: `
        SELECT
          toStartOfHour(event_time) AS hour,
          event_name,
          environment,
          source,
          community_id,
          toUInt64(count()) AS event_count,
          uniqStateIf(user_id_hash, user_id_hash != '') AS unique_users_state,
          uniqStateIf(session_id, session_id != '') AS unique_sessions_state
        FROM analytics_events_raw
        GROUP BY hour, event_name, environment, source, community_id
      `,
    }),
  ],
})

export const mvOnboardingSteps = defineMaterializedView("mv_onboarding_steps", {
  datasource: onboardingStepsMv,
  nodes: [
    node({
      name: "materialize_onboarding_steps",
      sql: `
        SELECT
          event_id,
          event_time,
          environment,
          source,
          user_id_hash,
          session_id,
          event_name AS step_name,
          multiIf(
            event_name = 'auth_started', 10,
            event_name = 'auth_session_exchanged', 20,
            event_name = 'unique_human_verification_started', 30,
            event_name = 'unique_human_verification_succeeded', 40,
            event_name = 'reddit_verification_started', 50,
            event_name = 'reddit_verification_code_generated', 60,
            event_name = 'reddit_verification_succeeded', 70,
            event_name = 'reddit_import_queued', 80,
            event_name = 'reddit_import_started', 90,
            event_name = 'reddit_import_succeeded', 100,
            event_name = 'handle_claim_started', 110,
            event_name = 'handle_claim_succeeded', 120,
            event_name = 'onboarding_completed', 130,
            event_name = 'onboarding_skipped', 140,
            255
          ) AS step_order,
          multiIf(
            event_name IN ('unique_human_verification_failed', 'reddit_verification_failed', 'reddit_import_failed'), 'failed',
            event_name = 'onboarding_skipped', 'skipped',
            event_name IN ('unique_human_verification_succeeded', 'reddit_verification_succeeded', 'reddit_import_succeeded', 'handle_claim_succeeded', 'onboarding_completed'), 'succeeded',
            'started'
          ) AS outcome
        FROM analytics_events_raw
        WHERE event_name IN (
          'auth_started',
          'auth_session_exchanged',
          'unique_human_verification_started',
          'unique_human_verification_succeeded',
          'unique_human_verification_failed',
          'reddit_verification_started',
          'reddit_verification_code_generated',
          'reddit_verification_succeeded',
          'reddit_verification_failed',
          'reddit_import_queued',
          'reddit_import_started',
          'reddit_import_succeeded',
          'reddit_import_failed',
          'handle_claim_started',
          'handle_claim_succeeded',
          'onboarding_completed',
          'onboarding_skipped'
        )
      `,
    }),
  ],
})

export const mvActivationCohorts = defineMaterializedView("mv_activation_cohorts", {
  datasource: activationEventsMv,
  nodes: [
    node({
      name: "materialize_activation_events",
      sql: `
        SELECT
          event_id,
          event_time,
          environment,
          source,
          user_id_hash,
          session_id,
          community_id,
          event_name AS activation_name
        FROM analytics_events_raw
        WHERE event_name IN (
          'post_created',
          'comment_created',
          'post_voted',
          'comment_voted',
          'community_followed'
        )
        AND source != 'backfill'
      `,
    }),
  ],
})

export const mvCommunityHealthDaily = defineMaterializedView("mv_community_health_daily", {
  datasource: communityHealthDailyMv,
  nodes: [
    node({
      name: "materialize_community_health_daily",
      sql: `
        SELECT
          toDate(event_time) AS day,
          community_id,
          environment,
          toUInt64(count()) AS total_events,
          toUInt64(countIf(event_name = 'community_viewed')) AS views,
          toUInt64(countIf(event_name = 'community_followed')) AS follows,
          toUInt64(countIf(event_name = 'post_created')) AS posts,
          toUInt64(countIf(event_name = 'comment_created')) AS comments,
          toUInt64(countIf(event_name IN ('post_voted', 'comment_voted'))) AS votes,
          uniqStateIf(user_id_hash, user_id_hash != '') AS active_users_state
        FROM analytics_events_raw
        WHERE community_id != ''
        AND source != 'backfill'
        GROUP BY day, community_id, environment
      `,
    }),
  ],
})

export const mvCommerceFunnelDaily = defineMaterializedView("mv_commerce_funnel_daily", {
  datasource: commerceFunnelDailyMv,
  nodes: [
    node({
      name: "materialize_commerce_funnel_daily",
      sql: `
        SELECT
          toDate(event_time) AS day,
          community_id,
          environment,
          toUInt64(countIf(event_name = 'purchase_quote_requested')) AS quotes_requested,
          toUInt64(countIf(event_name = 'purchase_quote_created')) AS quotes_created,
          toUInt64(countIf(event_name = 'checkout_started')) AS checkouts_started,
          toUInt64(countIf(event_name = 'purchase_submitted')) AS purchases_submitted,
          toUInt64(countIf(event_name = 'purchase_confirmed')) AS purchases_confirmed,
          toUInt64(countIf(event_name = 'purchase_failed')) AS purchases_failed,
          toUInt64(countIf(event_name = 'entitlement_granted')) AS entitlements_granted,
          uniqStateIf(user_id_hash, event_name = 'purchase_quote_requested' AND user_id_hash != '') AS quote_users_state,
          uniqStateIf(user_id_hash, event_name = 'purchase_confirmed' AND user_id_hash != '') AS purchase_users_state
        FROM analytics_events_raw
        WHERE event_name IN (
          'purchase_quote_requested',
          'purchase_quote_created',
          'checkout_started',
          'purchase_submitted',
          'purchase_confirmed',
          'purchase_failed',
          'entitlement_granted'
        )
        AND source != 'backfill'
        GROUP BY day, community_id, environment
      `,
    }),
  ],
})

export const mvImportQualityDaily = defineMaterializedView("mv_import_quality_daily", {
  datasource: importQualityDailyMv,
  nodes: [
    node({
      name: "materialize_import_quality_daily",
      sql: `
        SELECT
          toDate(event_time) AS day,
          environment,
          toUInt64(countIf(event_name = 'reddit_verification_started')) AS verifications_started,
          toUInt64(countIf(event_name = 'reddit_verification_succeeded')) AS verifications_succeeded,
          toUInt64(countIf(event_name = 'reddit_verification_failed')) AS verifications_failed,
          toUInt64(countIf(event_name = 'reddit_import_started')) AS imports_started,
          toUInt64(countIf(event_name = 'reddit_import_succeeded')) AS imports_succeeded,
          toUInt64(countIf(event_name = 'reddit_import_failed')) AS imports_failed,
          uniqStateIf(user_id_hash, user_id_hash != '') AS unique_users_state
        FROM analytics_events_raw
        WHERE event_name IN (
          'reddit_verification_started',
          'reddit_verification_succeeded',
          'reddit_verification_failed',
          'reddit_import_started',
          'reddit_import_succeeded',
          'reddit_import_failed'
        )
        GROUP BY day, environment
      `,
    }),
  ],
})

export const onboardingFunnel = defineEndpoint("onboarding_funnel", {
  description: "Onboarding conversion funnel by first auth-start cohort.",
  params: {
    environment: p.string(),
    cohort_start: p.dateTime64().optional("1970-01-01 00:00:00.000"),
    cohort_end: p.dateTime64().optional("2100-01-01 00:00:00.000"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        WITH
          cohort AS (
            SELECT
              user_id_hash,
              minIf(event_time, step_name = 'auth_started') AS auth_started_at,
              minIf(event_time, step_name = 'auth_session_exchanged') AS auth_exchanged_at,
              minIf(event_time, step_name = 'unique_human_verification_started') AS human_verify_started_at,
              minIf(event_time, step_name = 'unique_human_verification_succeeded') AS human_verify_succeeded_at,
              minIf(event_time, step_name = 'reddit_verification_started') AS reddit_verify_started_at,
              minIf(event_time, step_name = 'reddit_verification_code_generated') AS reddit_code_generated_at,
              minIf(event_time, step_name = 'reddit_verification_succeeded') AS reddit_verify_succeeded_at,
              minIf(event_time, step_name = 'reddit_import_queued') AS reddit_import_queued_at,
              minIf(event_time, step_name = 'reddit_import_started') AS reddit_import_started_at,
              minIf(event_time, step_name = 'reddit_import_succeeded') AS reddit_import_succeeded_at,
              minIf(event_time, step_name = 'handle_claim_started') AS handle_claim_started_at,
              minIf(event_time, step_name = 'handle_claim_succeeded') AS handle_claim_succeeded_at,
              minIf(event_time, step_name = 'onboarding_completed') AS onboarding_completed_at,
              minIf(event_time, step_name = 'onboarding_skipped') AS onboarding_skipped_at
            FROM onboarding_steps_mv
            WHERE environment = {{String(environment)}}
            GROUP BY user_id_hash
            HAVING auth_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')
            AND auth_started_at >= {{DateTime64(cohort_start)}}
            AND auth_started_at < {{DateTime64(cohort_end)}}
          ),
          funnel AS (
            SELECT 10 AS step_order, 'auth_started' AS step_name, countIf(auth_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) AS users FROM cohort
            UNION ALL SELECT 20, 'auth_session_exchanged', countIf(auth_exchanged_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 30, 'unique_human_verification_started', countIf(human_verify_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 40, 'unique_human_verification_succeeded', countIf(human_verify_succeeded_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 50, 'reddit_verification_started', countIf(reddit_verify_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 60, 'reddit_verification_code_generated', countIf(reddit_code_generated_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 70, 'reddit_verification_succeeded', countIf(reddit_verify_succeeded_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 80, 'reddit_import_queued', countIf(reddit_import_queued_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 90, 'reddit_import_started', countIf(reddit_import_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 100, 'reddit_import_succeeded', countIf(reddit_import_succeeded_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 110, 'handle_claim_started', countIf(handle_claim_started_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 120, 'handle_claim_succeeded', countIf(handle_claim_succeeded_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 130, 'onboarding_completed', countIf(onboarding_completed_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
            UNION ALL SELECT 140, 'onboarding_skipped', countIf(onboarding_skipped_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) FROM cohort
          ),
          baseline AS (
            SELECT maxIf(users, step_name = 'auth_started') AS started_users
            FROM funnel
          )
        SELECT
          step_order,
          step_name,
          users,
          round(users / nullIf(started_users, 0), 4) AS rate_from_start
        FROM funnel
        CROSS JOIN baseline
        ORDER BY step_order ASC
      `,
    }),
  ],
  output: {
    step_order: t.uint8(),
    step_name: t.string(),
    users: t.uint64(),
    rate_from_start: t.float64(),
  },
})

export type OnboardingFunnelParams = InferParams<typeof onboardingFunnel>
export type OnboardingFunnelOutput = InferOutputRow<typeof onboardingFunnel>

export const activationFunnel = defineEndpoint("activation_funnel", {
  description: "Activation by auth-session cohort week.",
  params: {
    environment: p.string(),
    cohort_start: p.dateTime64().optional("1970-01-01 00:00:00.000"),
    cohort_end: p.dateTime64().optional("2100-01-01 00:00:00.000"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        WITH
          cohort_users AS (
            SELECT
              user_id_hash,
              minIf(event_time, step_name = 'auth_session_exchanged') AS auth_exchanged_at,
              toStartOfWeek(minIf(event_time, step_name = 'auth_session_exchanged')) AS cohort_week
            FROM onboarding_steps_mv
            WHERE environment = {{String(environment)}}
            GROUP BY user_id_hash
            HAVING auth_exchanged_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')
            AND auth_exchanged_at >= {{DateTime64(cohort_start)}}
            AND auth_exchanged_at < {{DateTime64(cohort_end)}}
          ),
          activation_users AS (
            SELECT
              user_id_hash,
              minIf(event_time, activation_name = 'post_created') AS first_post_at,
              minIf(event_time, activation_name = 'comment_created') AS first_comment_at,
              minIf(event_time, activation_name IN ('post_voted', 'comment_voted')) AS first_vote_at,
              minIf(event_time, activation_name = 'community_followed') AS first_follow_at
            FROM activation_events_mv
            WHERE environment = {{String(environment)}}
            GROUP BY user_id_hash
          )
        SELECT
          c.cohort_week,
          count() AS cohort_size,
          countIf(a.first_post_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) AS activated_post,
          countIf(a.first_comment_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) AS activated_comment,
          countIf(a.first_vote_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) AS activated_vote,
          countIf(a.first_follow_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) AS activated_follow,
          round(countIf(a.first_post_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) / nullIf(count(), 0), 4) AS post_rate,
          round(countIf(a.first_comment_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) / nullIf(count(), 0), 4) AS comment_rate,
          round(countIf(a.first_vote_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) / nullIf(count(), 0), 4) AS vote_rate,
          round(countIf(a.first_follow_at > toDateTime64('1970-01-01 00:00:00', 3, 'UTC')) / nullIf(count(), 0), 4) AS follow_rate
        FROM cohort_users AS c
        LEFT JOIN activation_users AS a USING user_id_hash
        GROUP BY c.cohort_week
        ORDER BY c.cohort_week ASC
      `,
    }),
  ],
  output: {
    cohort_week: t.dateTime(),
    cohort_size: t.uint64(),
    activated_post: t.uint64(),
    activated_comment: t.uint64(),
    activated_vote: t.uint64(),
    activated_follow: t.uint64(),
    post_rate: t.float64(),
    comment_rate: t.float64(),
    vote_rate: t.float64(),
    follow_rate: t.float64(),
  },
})

export type ActivationFunnelParams = InferParams<typeof activationFunnel>
export type ActivationFunnelOutput = InferOutputRow<typeof activationFunnel>

export const communityHealth = defineEndpoint("community_health", {
  description: "Daily community health metrics.",
  params: {
    environment: p.string(),
    community_id: p.string().optional(""),
    start_date: p.date().optional("1970-01-01"),
    end_date: p.date().optional("2100-01-01"),
    limit: p.int32().optional(100),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
          day,
          community_id,
          sum(total_events) AS total_events,
          sum(views) AS views,
          sum(follows) AS follows,
          sum(posts) AS posts,
          sum(comments) AS comments,
          sum(votes) AS votes,
          uniqMerge(active_users_state) AS active_users
        FROM community_health_daily_mv
        WHERE environment = {{String(environment)}}
        AND ({{String(community_id, '')}} = '' OR community_id = {{String(community_id, '')}})
        AND day >= {{Date(start_date)}}
        AND day < {{Date(end_date)}}
        GROUP BY day, community_id
        ORDER BY day DESC, community_id ASC
        LIMIT {{Int32(limit, 100)}}
      `,
    }),
  ],
  output: {
    day: t.date(),
    community_id: t.string(),
    total_events: t.uint64(),
    views: t.uint64(),
    follows: t.uint64(),
    posts: t.uint64(),
    comments: t.uint64(),
    votes: t.uint64(),
    active_users: t.uint64(),
  },
})

export type CommunityHealthParams = InferParams<typeof communityHealth>
export type CommunityHealthOutput = InferOutputRow<typeof communityHealth>

export const commerceFunnel = defineEndpoint("commerce_funnel", {
  description: "Daily commerce quote-to-purchase funnel.",
  params: {
    environment: p.string(),
    community_id: p.string().optional(""),
    start_date: p.date().optional("1970-01-01"),
    end_date: p.date().optional("2100-01-01"),
    limit: p.int32().optional(100),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
          day,
          community_id,
          quotes_requested,
          quotes_created,
          checkouts_started,
          purchases_submitted,
          purchases_confirmed,
          purchases_failed,
          entitlements_granted,
          unique_quote_users,
          unique_purchase_users,
          round(purchases_confirmed / nullIf(quotes_requested, 0), 4) AS quote_to_purchase_rate,
          round(entitlements_granted / nullIf(purchases_confirmed, 0), 4) AS entitlement_grant_rate
        FROM (
          SELECT
            day,
            community_id,
            sum(quotes_requested) AS quotes_requested,
            sum(quotes_created) AS quotes_created,
            sum(checkouts_started) AS checkouts_started,
            sum(purchases_submitted) AS purchases_submitted,
            sum(purchases_confirmed) AS purchases_confirmed,
            sum(purchases_failed) AS purchases_failed,
            sum(entitlements_granted) AS entitlements_granted,
            uniqMerge(quote_users_state) AS unique_quote_users,
            uniqMerge(purchase_users_state) AS unique_purchase_users
          FROM commerce_funnel_daily_mv
          WHERE environment = {{String(environment)}}
          AND ({{String(community_id, '')}} = '' OR community_id = {{String(community_id, '')}})
          AND day >= {{Date(start_date)}}
          AND day < {{Date(end_date)}}
          GROUP BY day, community_id
        )
        ORDER BY day DESC, community_id ASC
        LIMIT {{Int32(limit, 100)}}
      `,
    }),
  ],
  output: {
    day: t.date(),
    community_id: t.string(),
    quotes_requested: t.uint64(),
    quotes_created: t.uint64(),
    checkouts_started: t.uint64(),
    purchases_submitted: t.uint64(),
    purchases_confirmed: t.uint64(),
    purchases_failed: t.uint64(),
    entitlements_granted: t.uint64(),
    unique_quote_users: t.uint64(),
    unique_purchase_users: t.uint64(),
    quote_to_purchase_rate: t.float64(),
    entitlement_grant_rate: t.float64(),
  },
})

export type CommerceFunnelParams = InferParams<typeof commerceFunnel>
export type CommerceFunnelOutput = InferOutputRow<typeof commerceFunnel>

export const retentionCohorts = defineEndpoint("retention_cohorts", {
  description: "Daily retention cohorts based on auth session exchange.",
  params: {
    environment: p.string(),
    cohort_start: p.dateTime64().optional("1970-01-01 00:00:00.000"),
    cohort_end: p.dateTime64().optional("2100-01-01 00:00:00.000"),
    max_age_days: p.int32().optional(30),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        WITH
          cohort_users AS (
            SELECT
              user_id_hash,
              toDate(min(event_time)) AS cohort_day
            FROM onboarding_steps_mv
            WHERE environment = {{String(environment)}}
            AND step_name = 'auth_session_exchanged'
            AND event_time >= {{DateTime64(cohort_start)}}
            AND event_time < {{DateTime64(cohort_end)}}
            GROUP BY user_id_hash
          ),
          cohort_sizes AS (
            SELECT
              cohort_day,
              count() AS cohort_size
            FROM cohort_users
            GROUP BY cohort_day
          ),
          activity_days AS (
            SELECT
              user_id_hash,
              toDate(event_time) AS activity_day
            FROM analytics_events_raw
            WHERE environment = {{String(environment)}}
            AND event_name IN (
              'home_feed_viewed',
              'community_viewed',
              'community_followed',
              'post_created',
              'comment_created',
              'post_voted',
              'comment_voted',
              'thread_viewed',
              'purchase_confirmed'
            )
            AND source != 'backfill'
            GROUP BY user_id_hash, activity_day
          )
        SELECT
          c.cohort_day,
          dateDiff('day', c.cohort_day, a.activity_day) AS age_day,
          s.cohort_size,
          uniqExact(c.user_id_hash) AS retained_users,
          round(retained_users / nullIf(s.cohort_size, 0), 4) AS retention_rate
        FROM cohort_users AS c
        INNER JOIN activity_days AS a ON a.user_id_hash = c.user_id_hash
        INNER JOIN cohort_sizes AS s ON s.cohort_day = c.cohort_day
        WHERE a.activity_day >= c.cohort_day
        AND age_day <= {{Int32(max_age_days, 30)}}
        GROUP BY c.cohort_day, age_day, s.cohort_size
        ORDER BY c.cohort_day ASC, age_day ASC
      `,
    }),
  ],
  output: {
    cohort_day: t.date(),
    age_day: t.int32(),
    cohort_size: t.uint64(),
    retained_users: t.uint64(),
    retention_rate: t.float64(),
  },
})

export type RetentionCohortsParams = InferParams<typeof retentionCohorts>
export type RetentionCohortsOutput = InferOutputRow<typeof retentionCohorts>

export const eventQuality = defineEndpoint("event_quality", {
  description: "Hourly ingestion quality checks.",
  params: {
    environment: p.string(),
    start_time: p.dateTime64().optional("1970-01-01 00:00:00.000"),
    end_time: p.dateTime64().optional("2100-01-01 00:00:00.000"),
    limit: p.int32().optional(200),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
          toStartOfHour(event_time) AS hour,
          environment,
          source,
          count() AS received_events,
          uniqExact(event_id) AS unique_event_ids,
          count() - uniqExact(event_id) AS duplicate_event_ids,
          countIf(event_id = '') AS missing_event_id,
          countIf(event_name = '') AS missing_event_name,
          countIf(user_id_hash = '' AND anonymous_id = '') AS missing_identity,
          countIf(environment NOT IN ('development', 'staging', 'production')) AS invalid_environment,
          countIf(source NOT IN ('web', 'api', 'job', 'backfill')) AS invalid_source
        FROM analytics_events_raw
        WHERE environment = {{String(environment)}}
        AND event_time >= {{DateTime64(start_time)}}
        AND event_time < {{DateTime64(end_time)}}
        GROUP BY hour, environment, source
        ORDER BY hour DESC, source ASC
        LIMIT {{Int32(limit, 200)}}
      `,
    }),
  ],
  output: {
    hour: t.dateTime(),
    environment: t.string(),
    source: t.string(),
    received_events: t.uint64(),
    unique_event_ids: t.uint64(),
    duplicate_event_ids: t.uint64(),
    missing_event_id: t.uint64(),
    missing_event_name: t.uint64(),
    missing_identity: t.uint64(),
    invalid_environment: t.uint64(),
    invalid_source: t.uint64(),
  },
})

export type EventQualityParams = InferParams<typeof eventQuality>
export type EventQualityOutput = InferOutputRow<typeof eventQuality>

export const datasources = {
  analyticsEventsRaw,
  eventsHourlyMv,
  onboardingStepsMv,
  activationEventsMv,
  communityHealthDailyMv,
  commerceFunnelDailyMv,
  importQualityDailyMv,
}

export const pipes = {
  mvEventsHourly,
  mvOnboardingSteps,
  mvActivationCohorts,
  mvCommunityHealthDaily,
  mvCommerceFunnelDaily,
  mvImportQualityDaily,
  onboardingFunnel,
  activationFunnel,
  communityHealth,
  commerceFunnel,
  retentionCohorts,
  eventQuality,
}

export const tinybird = new Tinybird({
  datasources,
  pipes,
  token: process.env.TINYBIRD_TOKEN,
  baseUrl: process.env.TINYBIRD_URL,
})
