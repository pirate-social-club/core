# Song Study Rollout

Use this when promoting Song Study, the "Duolingo exercises from a song" activity, across core, API, contracts, and web.

Song Study depends on all of these surfaces being aligned:

- core community-template migrations
- OpenAPI source and generated contracts
- API study routes, async generation job, and community study policy
- web post-card Study CTA and `/p/:postId/study`
- hosted secrets and per-community rollout flags

## 1. Merge order

Land in this order:

1. Core migrations and OpenAPI source.
2. Generated `@pirate/api-contracts`.
3. API service and route implementation.
4. Web client and route implementation.
5. Staging secret/flag rollout.
6. Per-community shard expansion.

Do not deploy API/web against a core revision that lacks the Song Study community-template migrations. The runtime migration loader reads `db/community-template/migrations` from the configured core repo path.

## 2. Core gates

Required files:

- `db/community-template/migrations/*_song_study.sql`
- `db/community-template/migrations/*_community_study_enabled.sql`
- `specs/api/src/components/schemas/song-study.yaml`
- `specs/api/src/paths/song-study.yaml`
- `specs/domain/song-study.md`

Before merge, confirm migration numbers against the current target branch. If other in-flight migrations have claimed the same numbers, renumber Song Study at merge time; the migrations are additive and do not depend on occupying the original slots.

Run:

```bash
rtk bun run check:migrations
rtk bun specs/api/scripts/bundle-openapi.ts
rtk bun specs/api/scripts/bundle-openapi-implemented.ts
```

Expected implemented bundle delta: the three Song Study operations are present:

- `GET /communities/{community_id}/posts/{post_id}/study`
- `POST /communities/{community_id}/posts/{post_id}/study/attempts`
- `POST /communities/{community_id}/posts/{post_id}/study/transcriptions`

If `rtk bun specs/api/scripts/verify-openapi.ts` fails in the contracts typecheck step because local `@types/node` is corrupt or missing, repair the API contracts install before treating freshness as verified. Do not use a manual additive contracts patch as final release evidence.

## 3. Contracts gates

Regenerate `@pirate/api-contracts` only from a core branch that already includes the current replay, karaoke, commerce, and Song Study OpenAPI source. A partial core branch can silently delete unrelated contract surface.

After generation, confirm:

- `SongStudyCapability`
- `SongStudyPayload`
- `SongStudyExercise`
- `SongStudyAttemptRequest`
- `SongStudyAttemptResult`
- `SongStudyTranscriptionResponse`
- `apiRoutes.communityPostStudy`
- `apiRoutes.communityPostStudyAttempts`
- `apiRoutes.communityPostStudyTranscriptions`

Run:

```bash
rtk bun run check:consumer
rtk bun run check:fresh
```

`check:fresh` must pass for final merge. If it fails because the generated file would remove unrelated replay/karaoke/commerce types, the wrong core branch is being used for generation.

## 4. API gates

Expected behavior:

- `GET .../study` is not a paid OpenRouter call path.
- First entitled GET creates local say-it-back units, queues `song_study_generate`, writes processing localization rows, and returns a ready say-it-back pack.
- `song_study_generate` owns translation generation and rechecks ready state before calling OpenRouter.
- Unit inserts are idempotent for concurrent first hits.
- Target languages are normalized and allowlisted.
- Per-post target-language generation is capped by `SONG_STUDY_GENERATION_TARGET_LANGUAGE_LIMIT`.
- Answer integrity is server-only: no correct option in ready payloads, answer disclosed only by attempt response when allowed.

Run:

```bash
rtk bun test services/api/tests/lib/posts/post-study-service.test.ts
rtk bun test tests/routes/communities/community-study-routes.test.ts
rtk bun run check
```

Run the last command from `api/services/api`, not the API repo root.

## 5. Web gates

Expected behavior:

- Post-card Study CTA uses server `study_capability` when present.
- The client does not derive answer correctness locally.
- The study route submits attempts to the server and uses returned `correct_option_id`, `feedback`, `attempts_remaining`, and `next_review_hint`.
- Locked study uses the existing song purchase flow when a listing is available.
- Ref-backed lyrics do not need to be inline on the card; the study route is the authority for pack loading.

Run targeted checks:

```bash
rtk bun test src/app/authenticated-helpers/post-media-presentation.test.ts
rtk bun test src/app/router.test.ts src/app/route-manifest.test.ts
```

Run `rtk bun run types:safe` before final merge. If it fails on unrelated create-post contract drift, fix the contract alignment rather than waiving the typecheck for release.

## 6. Secrets and config

Before hosted rollout, confirm these API secrets/config values:

- `OPENROUTER_API_KEY` is present in hosted API environments.
- `SONG_STUDY_GENERATION_TARGET_LANGUAGE_LIMIT` is either unset, to use the code default, or set to a positive integer.

Use the Pirate Infisical profile before reading or writing secrets:

```bash
printf '\n' | rtk infisical user switch >/dev/null
```

Do not commit secrets or paste secret values into logs, tickets, or chat.

If `OPENROUTER_API_KEY` is absent, study still returns say-it-back exercises, but translation choices will not generate. Treat that as a degraded rollout state, not a full pass.

## 7. Per-community rollout

Community jobs are drained by the API scheduled batch, not by a push queue. The cron fires every minute, rotates task order, starts at most two scheduled tasks at a time, and stops starting new tasks after a 30-second batch deadline. Say-it-back should be ready on first study load; translation-choice readiness depends on the next successful `process_community_jobs` scheduled pass for that community.

For each rollout batch:

1. Apply the community-template migrations to the target community shards.
2. Confirm `song_study_unit`, `song_study_unit_localization`, `song_study_attempt`, and `song_study_review_state` exist.
3. Set `communities.study_enabled = true` only for the target communities.
4. Confirm the community job runner is draining `song_study_generate`.
5. Expand to the next batch only after the smoke matrix passes.

Roll back by setting `study_enabled = false` for affected communities. Keep the tables and attempt events; they are additive and can be reused after a fix.

## 8. Due-review and streak GA rollout

The due-review/streak launch is a schema-gated dark rollout. Code may deploy
before activation, but due-review serving MUST remain disabled until every
community shard has the 1121 attempt-identity migration.

Required core/API artifacts:

- `1118_song_study_review_sessions.sql` may already be present on staging
  shards; it is superseded by 1121.
- `1119_song_streaks.sql` adds `song_engagement_days` and `song_streaks`.
- `1121_song_study_attempt_identity.sql` rebuilds `song_study_attempt`,
  removes `review_session_id`, and leaves only
  `UNIQUE(user_id, idempotency_key)`.
- API code must default both `SONG_STUDY_DUE_REVIEW_SERVING_ENABLED` and
  `SONG_STUDY_STREAK_WRITES_ENABLED` to false.

Pre-merge gates:

1. Core migration integrity passes.
2. Data-preserving 1121 migration test passes: an existing attempt row with
   `review_session_id` survives, the column is gone, idempotency uniqueness
   remains, and repeated `(exercise_id, attempt_number)` under a new
   idempotency key succeeds.
3. API community schema snapshot is fresh from the same core revision.
4. Public contracts contain no `review_session_id` / `reviewSessionId`.
5. API runtime contains no `hasAttemptNumber`, old
   `attempt_number has already been recorded` conflict path, or
   `NOT EXISTS song_study_attempt` study-read filter.
6. Study read path is review-state based:
   - flag off: serve cards with no `song_study_review_state` row only.
   - flag on: serve cards with no row OR `due_at <= now`.
7. Ready-but-caught-up remains `access: "ready"`, `exercises: []`, and session
   metadata including `next_due_at` when available.
8. Answer integrity remains server-authoritative: no correct option in GET
   study payloads; `correct_option_id` is disclosed only by spent attempt
   responses.
9. `attempt_number` remains presentation/reveal state and
   `attempt_number > max_attempts` still returns 400.
10. Streak materialization is gated and deferred via `waitUntil` when available;
    the deferred write uses a transaction.
11. A focused leaderboard route/service test covers ordering, access, identity
    hydration, viewer standing, and public IDs.
12. Run the orphaned-attempt coverage query from
    [Song Study 1121 Shard Verifier](./song-study-1121-shard-verifier.md) on a
    prod shard sample. Nonzero means the dark deploy is not perfectly inert for
    those rows, because already-attempted units without review state can
    re-serve once under the final `review_state IS NULL` predicate.

Shard rollout sequence:

1. Deploy core/API/web with both study flags dark.
2. Canary one low-risk shard. Apply community-template migrations through 1121.
3. On the canary shard, run the
   [Song Study 1121 Shard Verifier](./song-study-1121-shard-verifier.md),
   including BEFORE/AFTER row-count and fingerprint comparisons. Also verify:
   - `schema_migrations` includes 1118, 1119, 1120 if applicable, and 1121.
   - `song_study_attempt` has no `review_session_id` column.
   - `song_study_attempt` has no unique index/constraint on
     `(user_id, exercise_id, attempt_number)`.
   - `song_engagement_days` and `song_streaks` exist.
   - For a local mirror/export of a shard, run:

     ```bash
     rtk bun scripts/community/verify-song-study-ga-schema.ts --db /path/to/community.db
     ```
4. Smoke with both flags still off:
   - already-reviewed cards do not re-serve even if `due_at <= now`;
   - first-learn cards still serve;
   - streak tables are not written.
5. Expand the same migration to the rest of the shard fleet.
6. Run an all-shards sweep. Do not proceed unless every ready community shard is
   at 1121 and has the final `song_study_attempt` identity shape.
   Use the 1121 shard verifier as the per-shard acceptance predicate when
   checking local mirrors/exports; when inspecting D1 directly, reproduce the
   same row-count, fingerprint, `schema_migrations`, `pragma_table_info`, and
   `pragma_index_*` checks.
7. Enable `SONG_STUDY_DUE_REVIEW_SERVING_ENABLED`.
8. Smoke one due review: GET re-serves a due card, attempt 1 under a new
   idempotency key succeeds, and no attempt-number conflict appears.
9. Enable `SONG_STUDY_STREAK_WRITES_ENABLED` for the target environment or
   cohort.
10. Smoke streak writes: a qualifying study attempt writes
    `song_engagement_days`, schedules materialization, and the leaderboard
    returns the viewer standing.

The all-shards 1121 gate is non-negotiable. On any shard that still has the old
`UNIQUE(user_id, exercise_id, attempt_number)`, due-review re-serving can
recreate the original repeat-attempt 409 failure.

If the rollout must stop after code deploy, leave both flags false. In that
state the code should behave like one-and-done Study: new cards serve, reviewed
cards stay hidden, and streak writes stay dark.

## 9. Staging smoke matrix

Use at least one public song and one locked paid song with lyrics.

Public song:

- Post card shows Study when `study_capability.status = ready`.
- First `/p/:postId/study` load returns say-it-back immediately.
- The first load does not wait for OpenRouter.
- A `song_study_generate` job appears or runs.
- A later reload includes translation-choice exercises when OpenRouter succeeds.
- Multiple-choice answers are absent from the GET payload.
- A correct multiple-choice attempt returns `correct_option_id`.
- A wrong non-final multiple-choice attempt does not disclose `correct_option_id`.
- A final wrong multiple-choice attempt returns `outcome = revealed` and `correct_option_id`.
- Say-it-back records mic transcription, sends the transcript to the attempt endpoint, and shows server token feedback.

Locked song:

- Non-entitled viewer sees locked study, not exercise text.
- Purchase flow opens from the locked study surface when a listing exists.
- After settlement, study reloads and becomes ready.
- Author or active purchaser can open ready study.

Policy and fallback:

- `study_enabled = false` hides study capability and blocks study route content.
- Missing `OPENROUTER_API_KEY` still allows say-it-back-only study.
- Invalid provider output does not create answer-bearing localizations.
- One target language can fail generation without breaking an already-ready different target language.

## 10. Production expansion

### 10.1 Base Song Study

After staging:

1. Deploy core migration bundle.
2. Deploy API with the job handler and study routes.
3. Deploy web with the Study CTA and route.
4. Enable a small community batch.
5. Watch community job failures and API errors for study routes.
6. Expand batches only after translation generation cost and failure rate are understood.

Useful failure signals:

- `song_study_generate` job failures
- OpenRouter 4xx/5xx responses
- repeated `target_language is not supported`
- `Song study translation generation limit exceeded`
- route errors from `GET .../study`
- attempt idempotency conflicts

### 10.2 Study streak production go-live

Use this only after the study streak code, web surface, and feed-summary
batching are merged. As of 2026-07-06, the study leg has been validated on
staging for:

- a seeded three-day streak that reads as `current_streak = 3` from the full
  board, single-post payload, and feed payload;
- a stale three-day streak that qualified through one real deployed study
  attempt and reset to `current_streak = 1` while preserving
  `best_streak = 3` and advancing `total_qualified_days = 4`;
- a feed response containing two song posts, proving the batched
  multi-post `streak_summary` hydration path.

Important staging caveat: staging is frequently redeployed. Do not assume a
successful flags-on validation means the active staging Worker still has
`SONG_STUDY_STREAK_WRITES_ENABLED=true` or
`SONG_STUDY_DUE_REVIEW_SERVING_ENABLED=true`. Before manual staging
click-through, inspect or redeploy the active staging Worker with the intended
flag values.

Production sequence:

1. Confirm target scope.
   - Decide whether launch is all production communities or a named canary
     cohort.
   - Record the target community IDs and their routed D1 shard bindings from
     the control-plane routing table.
   - Pick at least one low-traffic canary shard that has real
     `song_study_attempt` rows. Empty shards do not exercise the 1121 rebuild's
     data-preservation risk.
   - Confirm karaoke streak credit is out of scope; production launch is study
     only.
2. Keep writes dark.
   - Confirm production API is deployed with
     `SONG_STUDY_STREAK_WRITES_ENABLED=false`.
   - Keep `SONG_STUDY_DUE_REVIEW_SERVING_ENABLED=false` until the 1121 fleet
     gate passes.
   - Read paths may remain live; missing streak tables must return empty/null
     summary data rather than fail feed/post reads.
3. Verify shard schema coverage before any flag flip.
   - For every target shard, confirm `schema_migrations` records:
     - `1118_song_study_review_sessions.sql`
     - `1119_song_streaks.sql`
     - `1120_restore_rights_review_cases.sql` when it exists in the target
       migration set
     - `1121_song_study_attempt_identity.sql`
   - Confirm `song_engagement_days` and `song_streaks` exist.
   - Confirm `song_study_attempt` has no `review_session_id` column.
   - Confirm `song_study_attempt` has only the final idempotency uniqueness
     shape, not `(user_id, exercise_id, attempt_number)`.
   - For local shard mirrors/exports, run:

     ```bash
     rtk bun scripts/community/verify-song-study-ga-schema.ts --db /path/to/community.db
     ```

   - For direct D1 inspection, reproduce the predicates in
     [Song Study 1121 Shard Verifier](./song-study-1121-shard-verifier.md).
     Ledger-only evidence is not sufficient.
4. Apply missing migrations if coverage is incomplete.
   - Apply the full contiguous community-template sequence to missing target
     shards: `1118_song_study_review_sessions.sql`,
     `1119_song_streaks.sql`, `1120_restore_rights_review_cases.sql`, and
     `1121_song_study_attempt_identity.sql`.
   - `1120_restore_rights_review_cases.sql` is unrelated to streaks but part of
     the contiguous target migration set. Confirm its code path is already
     deployed and intended before the DDL pass.
   - Apply DDL directly to D1 (`wrangler d1 execute` or D1 HTTP API), not through
     the community shard RPC worker. That worker rejects DDL by design.
   - Use an idempotent/resumable fleet script that skips already-applied
     migrations with matching checksums, halts on checksum drift, records
     per-shard pass/fail state, and backs off on transient D1 rate limits.
   - Capture BEFORE and AFTER row counts/fingerprints for
     `song_study_attempt` as described in the 1121 verifier.
   - Treat `1121_song_study_attempt_identity.sql` as the load-bearing rebuild:
     it creates `song_study_attempt_next`, copies rows, drops the old table,
     renames the new table, and recreates indexes. Run in a low-traffic window
     because concurrent study attempt writes may briefly serialize.
   - Before the first canary, confirm D1 Time Travel restore is available for
     the target shard. Time Travel restore is point-in-time and whole-database;
     it discards writes after the chosen restore point, so record that data-loss
     window explicitly.
   - Halt rollout on any canary mismatch; restore the failed shard before
     touching the rest of the fleet.
5. Run a dark smoke.
   - With both flags false, first-learn study still serves and attempts still
     record.
   - Already-reviewed cards do not re-serve because due-review serving is off.
   - A real study attempt does not write or update `song_engagement_days` or
     `song_streaks`.
6. Enable due-review serving for the canary scope.
   - Flip `SONG_STUDY_DUE_REVIEW_SERVING_ENABLED=true` only after every target
     shard passes 1121.
   - Smoke one due review: GET returns a due card, submitting attempt 1 under a
     new idempotency key succeeds, and no attempt-number conflict appears.
   - Confirm a caught-up song still returns `access: "ready"` with an empty
     exercise list and session metadata.
7. Enable streak writes for the canary scope.
   - Flip `SONG_STUDY_STREAK_WRITES_ENABLED=true`.
   - Run the post-flip production smoke below before considering the launch
     complete.

#### 10.2.1 Post-flip production smoke

This smoke is primarily a study-attempt safety check. Streak writes run in the
same transaction as `song_study_attempt`; if a production-only streak error
exists, it can roll back the study attempt itself. Keep the rollback ready before
starting:

```bash
# rollback trigger: use immediately if any real study attempt returns 5xx,
# conflicts for a fresh idempotency key, or otherwise fails after the write flag.
SONG_STUDY_STREAK_WRITES_ENABLED=false
```

Inputs to record:

- `COMMUNITY_ID`
- `POST_ID`
- routed production D1 database name, for example
  `community-d1-pool-0073-prod`
- authenticated test user id / handle
- UTC smoke date (`YYYY-MM-DD`)

Safety gates:

1. `GET /communities/:communityId/posts/:postId/study` succeeds for the
   authenticated user and returns at least one exercise, or returns due-review
   exercises for a caught-up song.
2. Submit study attempts through the real client or the production API:

   ```http
   POST /communities/:communityId/posts/:postId/study/attempts
   Authorization: Bearer <token>
   Content-Type: application/json
   ```

   Use the exercise payload returned by the study GET and a fresh
   `idempotency_key` per attempt. Continue until the day qualifies: either ten
   attempts for a fresh first-learn day, or the frozen due-review target for a
   due-review day. A seeded smoke may pre-create a ledger row at
   `study_attempt_count = 9`, `study_target_count = 10`, then submit one real
   deployed attempt, but the submitted attempt must still go through the
   production API.
3. If any attempt fails before qualification, immediately roll back streak writes
   and diagnose. Do not continue trying attempts on that post.

After the qualifying attempt, run the D1 read-back against the routed shard:

```sql
SELECT
  user_id,
  post_id,
  activity_date,
  study_attempt_count,
  study_correct_count,
  study_target_count,
  karaoke_pass_count,
  qualified,
  created_at,
  updated_at
FROM song_engagement_days
WHERE user_id = :user_id
  AND post_id = :post_id
  AND activity_date = :utc_date;

SELECT
  user_id,
  post_id,
  current_streak,
  best_streak,
  total_qualified_days,
  streak_started_date,
  last_qualified_date,
  updated_at
FROM song_streaks
WHERE user_id = :user_id
  AND post_id = :post_id;

SELECT
  COUNT(*) AS attempt_rows
FROM song_study_attempt
WHERE user_id = :user_id
  AND post_id = :post_id
  AND attempted_at >= :utc_date || 'T00:00:00.000Z'
  AND attempted_at < date(:utc_date, '+1 day') || 'T00:00:00.000Z';
```

Expected D1 assertions:

- `song_study_attempt.attempt_rows` increased by the number of submitted
  attempts.
- `song_engagement_days.study_attempt_count >= study_target_count`.
- `song_engagement_days.qualified = 1`.
- `song_streaks.current_streak >= 1`.
- `song_streaks.last_qualified_date = :utc_date`.
- `song_streaks.total_qualified_days` increments once for this date only; repeat
  submits/idempotent retries must not add another qualified day.

Then verify read surfaces with the same authenticated viewer:

- `GET /communities/:communityId/posts/:postId/streaks/leaderboard?limit=10`
  returns viewer standing for the smoke user.
- `GET /posts/:postId` returns `streak_summary.viewer` matching the board row.
- `GET /feed/home` returns the same `streak_summary.viewer` for that post. When
  possible, use a feed containing at least two song posts in the community so the
  batched feed reader is exercised.

Only after these pass should the rollout be considered live-verified. If board
or payload reads fail but study attempts continue to succeed, leave
`SONG_STUDY_STREAK_WRITES_ENABLED=true` only if the D1 rows are correct and the
failure is clearly read-path/UI-only; otherwise roll back writes while
diagnosing.

#### 10.2.2 Multi-day validation

After the post-flip production smoke, validate the behaviors that are difficult
to exercise naturally in one session:

8. Validate multi-day behavior before expanding.
   - Seed or select a user/post with a three-day live streak ending today and
     confirm board, post payload, and feed payload all report
     `current_streak = 3`.
   - Seed or select a stale streak whose `last_qualified_date` is before
     yesterday, qualify today through one real deployed attempt, and confirm
     `current_streak = 1`, `best_streak` is preserved, and
     `total_qualified_days` increments once.
9. Optional history seed.
   - History seeding may backfill `song_engagement_days` and `song_streaks`
     from historical `song_study_attempt` rows so launch is not all one-day
     streaks.
   - Historical rows cannot reconstruct frozen point-in-time due counts, so
     use `study_target_count = 10` for pre-launch days.
   - Run the same post/feed/board read smoke after seeding.
10. Expand.
    - Expand by shard or community cohort only after the canary has no route
      errors and no unexpected streak-write failures.
    - Keep an audit table/list of shards checked, migrations observed, flags
      flipped, and smoke post IDs used.

Rollback:

- To stop new streak writes, set `SONG_STUDY_STREAK_WRITES_ENABLED=false`.
  Existing `song_engagement_days` and `song_streaks` rows remain as audit data.
- To stop daily review re-serving, set
  `SONG_STUDY_DUE_REVIEW_SERVING_ENABLED=false`. This returns Study to the
  first-learn/caught-up behavior.
- Do not roll back 1119/1121 DDL in place during an incident. Treat schema
  rollback as shard restore work, not an application flag rollback.
- If a smoke shows attempts are written but engagement days are not, first
  verify the active Worker version and deployed flag values; staging proved
  this can be caused by an intervening deploy superseding a flags-on validation
  version.

Production signals to watch during streak launch:

- `[song-study] attempt timing` with `streak_writes_enabled`, `streak_deferred`,
  and `wait_until_available`.
- route errors from study attempts and streak leaderboard reads.
- D1 errors mentioning `song_engagement_days`, `song_streaks`, or
  `song_study_attempt` uniqueness.
- feed/home latency and D1 query volume for communities with many song posts.
- a mismatch between board `viewer`, post `streak_summary.viewer`, and feed
  `streak_summary.viewer` for the same `(user, post)`.

## 11. Launch notes

Attempts now update `song_study_review_state.due_at` with server-side intervals, so "spaced review state is recorded" is accurate. Do not market a full cross-song "due today" review product until there is a user-facing due-review surface that reads those schedules.
