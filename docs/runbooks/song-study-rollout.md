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

## 8. Staging smoke matrix

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

## 9. Production expansion

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

## 10. Launch notes

Attempts now update `song_study_review_state.due_at` with server-side intervals, so "spaced review state is recorded" is accurate. Do not market a full cross-song "due today" review product until there is a user-facing due-review surface that reads those schedules.
