# Song Study

Song Study is a learning activity attached to a song post: a learner practices
the song's lyrics through turn-based exercises (say-it-back, multiple-choice
translation) with spaced-repetition scheduling. It is a **sibling activity to
Karaoke, not a karaoke mode** — the two are independent capability axes on a
song and either, both, or neither may be available.

This document is the normative contract for the study endpoints. The OpenAPI
shapes live in `specs/api/src/paths/song-study.yaml` and
`specs/api/src/components/schemas/song-study.yaml`.

## Endpoints

```
GET  /communities/:community_id/posts/:post_id/study
POST /communities/:community_id/posts/:post_id/study/attempts
POST /communities/:community_id/posts/:post_id/study/transcriptions
```

The route is community-scoped, consistent with other post sub-resources.

## Authority

The server is the **sole authority** on study access and content delivery.

- The `access` field on the study payload is the only source of truth for
  whether a caller may study and whether exercise content is present.
- Clients MUST NOT derive study availability or access from the post payload
  shape (e.g. the presence of inline `timed_lyrics`). Post-card surfaces MAY
  use the server-derived `study_capability` summary on `LocalizedPostResponse`
  to decide whether to show a Study CTA, but MUST still load `GET .../study`
  before rendering study content.
- Study content (lyric text, translations, distractor options) is assembled
  from the authoritative store, gated by entitlement. The server MUST NOT depend
  on the public post payload to source study content.

## Authentication (v1)

`GET .../study` and `POST .../study/attempts` **require authentication** in v1.
Public / logged-out study is a later product decision that would require
token-optional access and explicit public/free entitlement handling. Until then,
unauthenticated callers receive `401 auth_error`, and the `locked` access state
is only ever observed by authenticated, non-entitled callers.

`POST .../study/transcriptions` also requires authentication and mirrors the
same entitlement predicate as `GET .../study`; the server MUST validate access
before sending audio to the speech-to-text provider.

## Access states

`access` is one of `ready`, `locked`, `processing`, `unavailable`.

- **ready** — the caller may study; exercise content is included. A ready v1
  response may initially contain only `say_it_back` exercises while
  target-language `translation_choice` localizations are generated
  asynchronously.
- **locked** — the post exists but access is denied. Returned with HTTP `200`
  and `access: "locked"`, **not** `404`, so the client can render the locked
  study surface with context. Paired with `locked_reason`.
- **processing** — no safe local exercises are ready yet and server-side
  preparation is pending. No exercise content. Normal first-load lazy
  generation should not block here when local say-it-back units can be created
  from lyrics.
- **unavailable** — the song cannot support study. Paired with
  `unavailable_reason`. No exercise content.

### Entitlement for locked songs

For a locked song, `access` is `ready` only if the caller is the **author OR
holds an active purchaser entitlement** — the same predicate the post card uses
(`public || purchase || author`). `viewer_is_author` alone is insufficient; this
is the authoritative resolution of the client-side card/route entitlement
mismatch.

## Normative invariants

These hold for every `GET .../study` response and are testable:

1. `object` is `song_study_payload`.
2. `exercise_count == exercises.length`.
3. If `access == "ready"`:
   - `exercises.length > 0` when work is currently available;
   - `exercises.length == 0` is allowed only for the caught-up state, where
     no first-learn or due-review exercise is currently serveable;
   - each included exercise carries its content (lyric / `reference_text` /
     `translation_text` / `options` as applicable);
   - `study_pack_version` and `generated_at` are present.
4. If `access != "ready"`:
   - `exercises == []` and `exercise_count == 0`;
   - the response contains **no** lyric text, **no** translations, and **no**
     distractor options;
   - `study_pack_version` and `generated_at` are omitted.
5. `locked_reason` is present **iff** `access == "locked"`.
6. `unavailable_reason` is present **iff** `access == "unavailable"`.
7. Always-safe metadata (`title`, and when known `artist_name`, `artwork_src`,
   `source_language`, `target_language`) MAY be returned in any access state.
   These are already visible on the post card and are not gated.
8. `line_id` is **stable** across fetches and across `study_pack_version` bumps
   for the same underlying line. It is the spaced-repetition review-unit key.

## Exercises

`line_id` + exercise `type` + the `(source_language, target_language)` pair form
the **review unit** for scheduling. `line_index` is presentation order only and
has no scheduling meaning.

### Answer integrity

No fetched exercise carries the correct answer.

- **translation_choice** — `options` is **server-shuffled**; the correct option
  is not identified in the payload. The client renders options in array order
  and MUST NOT re-sort, shuffle, or generate answers. Validation happens at the
  attempts endpoint.
- **say_it_back** — `reference_text` is the visible target line. It is **not** a
  grading secret: for an entitled learner the lyric line is already visible. The
  authoritative grade is produced by the attempts endpoint from the submitted
  transcript; the client does not perform the authoritative comparison.

Determinism: distractor selection and option ordering are computed server-side
and fixed in the response. Shared generated packs MAY store a canonical option
order for each exercise; clients MUST render the supplied array order and MUST
NOT reshuffle locally. No client-facing seed is exposed.

## Attempts and scheduling

`GET .../study` creates or resumes a server-issued session containing at most
ten distinct exercises. The session freezes the learner, song, target language,
exercise set, qualification target, and presentation limits. Clients MUST submit
the returned session id and cannot choose or alter those values on an attempt.

`POST .../study/attempts` validates one attempt **server-side**, records the
attempt as an **event** (not merely the final state, so the schedule can be
recomputed if the algorithm or parameters change), advances the FSRS schedule
for the review unit, and returns the verdict.

- Attempt writes MUST be idempotent. The client supplies an `idempotency_key`;
  the durable deduplication guarantees rest on `(user_id, idempotency_key)` and
  `(user_id, study_session_id, exercise_id, presentation_number)`.
  The server returns the original result for an equivalent retry and rejects
  conflicting payload reuse. A retry MUST NOT double-record an event or
  double-advance FSRS.
- `attempt_number` is the 1-based presentation number for that exercise in this
  server session. A future due review uses a different session id and may validly
  submit `attempt_number = 1` again.
- The correct answer is disclosed only once the attempt is spent — a correct
  answer, or an incorrect final attempt (`outcome: revealed`).
- `say_it_back` grading normalizes the transcript under the **source lyric
  language's** tokenization / accent / punctuation policy (whitespace
  tokenization is not sufficient for space-less scripts) and returns a token-level
  matched / missing / extra diff.

### FSRS mapping (server-internal)

Grading is **attempts-based**, deliberately not latency-based for `say_it_back`
(record + STT round-trip pollute timing):

- correct on the first attempt → good
- correct on the second attempt → hard
- failed after `max_attempts` → again

The server writes a due interval to `song_study_review_state.due_at` on each
accepted attempt. FSRS answers "when should this review unit reappear?". A
separate session/high score concept answers "how did this session go?" — the two
MUST NOT be conflated.

### Session completion and qualification

- A normal session contains `N = min(10, eligible exercise count)` distinct cards.
- The first-pass correctness target is `ceil(0.70 * N)`.
- A wrong card is eligible to reappear after other cards, at most three
  presentations per card.
- Total presentations are capped at `min(20, 3 * N)`.
- A session completes when all cards are mastered, every unresolved card has
  reached three presentations, or the global presentation cap is reached.
- Qualification requires all `N` distinct cards to have been presented and at
  least the first-pass correctness target to have been met. Repetitions teach
  mistakes but never inflate the first-pass score.
- Streak and reward qualification MUST consume this same completed-session
  decision. Neither path may independently infer completion from arbitrary
  attempts or trust a client-provided target language.

The attempt event, FSRS update, and session progress commit atomically. Derived
engagement-day, reward-outbox, and streak materialization writes intentionally
run afterward in an idempotent transaction. This creates a small
completed-session-before-derived-state consistency window if that second write
fails; an equivalent attempt retry re-drives the derived writes. There is no
background reconciliation sweep in the initial rollout.

### Due-review serving rollout

Current production Study is intentionally one-and-done: `GET .../study` hides
already-attempted exercises so the same `attempt_number = 1` is not re-served
and rejected. That is a short-term replay/409 fix, not the final
spaced-repetition contract.

The target read path is:

- Build the canonical first-learn candidates from ready study units and
  localizations.
- Build due-review candidates by joining `song_study_review_state` on
  `(user_id, post_id, line_id, exercise_type, target_language)` and selecting
  rows with `due_at <= now` that are still serveable under the same readiness
  filters as first-learn (`say_it_back_status = 'ready'`; localization ready
  with translation/options/correct id present).
- New cards with no review-state row are due now. Existing rows with
  `due_at > now` are hidden until their due time.
- If no first-learn or due-review candidate is serveable, return
  `access: "ready"`, `exercises: []`, and session metadata including
  `next_due_at` when every candidate has review state and the next serveable
  review is in the future.

`GET .../study` resumes the caller's unexpired active session for this song and
target language, or mints one from the currently due set. Re-fetching MUST NOT
reset first-pass results or presentation limits.

Rollout requirements:

1. Ship due-read metadata and caught-up payload shape while re-serving remains
   disabled.
2. Remove the durable uniqueness constraint on
   `(user_id, exercise_id, attempt_number)` from every community shard. Keep
   `(user_id, idempotency_key)`.
3. Only after step 2 is complete on all shards, enable due-review re-serving.
   Offering a due review before the old uniqueness constraint is gone can
   recreate the `attempt_number has already been recorded` failure.
4. Bind every accepted attempt to the server-issued session and enforce logical
   presentation uniqueness in storage.
5. Deploy the session-aware web client and API as one coordinated release.
   `session_id` is mandatory once the API change is live; older clients cannot
   submit attempts to the new endpoint contract.

## Scope

These endpoints describe **one song's full study pack**. FSRS-scheduled,
cross-song "due today" review sessions are a separate concern and are not
modeled here.

## Persistence

Study persistence is community-scoped. The canonical store for study packs,
attempt events, and review state is the community D1 database because study is
tied to community-owned song content. This mirrors karaoke attempts: ownership,
locality, deletion, and privacy boundaries follow the community and the song.

This is intentionally the opposite boundary from global bookings-like data:
bookings are not owned by a song post, but study data is.

### Privacy posture (v1)

Study is private learner data in v1.

- No public study leaderboards.
- No community aggregate study surfaces.
- No moderator/member reads of another learner's attempts by default.
- Any future social ranking, streak, or aggregate surface requires an explicit
  opt-in read model and access-control review.

If Pirate later needs a cross-community "due today" study dashboard, publish a
derived user-level projection/index. That projection is never the canonical
attempt or review-state store.

### Shared content vs. per-user state

The shared generated content is not per-user. The source lyric line selection is
canonical per song, while translation answers, distractors, and explanations are
localized per target language. Only answer ordering is deterministically
personalized at response time.

Shared content tables:

- `song_study_unit` — canonical source-line review units.
- `song_study_unit_localization` — target-language translation-choice payloads.

Per-user tables:

- `song_study_session`
- `song_study_session_exercise`
- `song_study_attempt`
- `song_study_review_state`

`source_language` is a song/unit property, not part of every per-user key.
`say_it_back` availability lives on the source unit. `translation_choice`
availability lives on the localization row because generation can succeed for
one target language and fail for another.

### Table shape sketch

The exact migration belongs in the implementation repo, but the schema should
follow this shape:

```sql
CREATE TABLE song_study_unit (
  id                 TEXT NOT NULL, -- stu_*
  post_id            TEXT NOT NULL,
  line_id            TEXT NOT NULL,
  line_index         INTEGER NOT NULL,
  source_language    TEXT,
  prompt_text        TEXT NOT NULL,
  reference_text     TEXT NOT NULL,
  say_it_back_status TEXT NOT NULL CHECK (say_it_back_status IN
                       ('ready','unavailable')),
  unit_version       INTEGER NOT NULL,
  max_attempts       INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (post_id, line_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);

CREATE INDEX idx_song_study_unit_post
  ON song_study_unit (post_id, line_index);

CREATE TABLE song_study_unit_localization (
  id                   TEXT NOT NULL, -- sul_*
  unit_id              TEXT NOT NULL,
  target_language      TEXT NOT NULL,
  localization_version INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN
                         ('ready','processing','unavailable')),
  question             TEXT,
  translation_text   TEXT,
  options_json       TEXT,          -- translation_choice options
  correct_option_id  TEXT,          -- server-side grading secret, never serialized by GET
  explanation_text   TEXT,
  max_attempts       INTEGER NOT NULL,
  generated_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (unit_id, target_language),
  FOREIGN KEY (unit_id) REFERENCES song_study_unit(id) ON DELETE CASCADE
);

CREATE INDEX idx_song_study_unit_localization_lookup
  ON song_study_unit_localization (target_language, status);
```

Attempt events are the source of truth. `study_pack_version` is stamped on each
attempt for audit/replay, but it is not part of the review-state key.

```sql
CREATE TABLE song_study_attempt (
  id                 TEXT NOT NULL, -- sta_*
  user_id            TEXT NOT NULL,
  post_id            TEXT NOT NULL,
  exercise_id        TEXT NOT NULL,
  line_id            TEXT NOT NULL,
  exercise_type      TEXT NOT NULL CHECK (exercise_type IN
                       ('say_it_back','translation_choice')),
  target_language    TEXT NOT NULL,
  study_pack_version INTEGER NOT NULL,
  attempt_number     INTEGER NOT NULL,
  idempotency_key    TEXT NOT NULL,
  selected_option_id TEXT,
  transcript         TEXT,          -- final say-it-back transcript only
  outcome            TEXT NOT NULL CHECK (outcome IN
                       ('correct','incorrect','revealed')),
  feedback_json      TEXT,
  fsrs_rating        TEXT CHECK (fsrs_rating IN
                       ('again','hard','good','easy')),
  created_at         TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_song_study_attempt_review_unit
  ON song_study_attempt
     (user_id, post_id, line_id, exercise_type, target_language, created_at);

CREATE TABLE song_study_review_state (
  user_id             TEXT NOT NULL,
  post_id             TEXT NOT NULL,
  line_id             TEXT NOT NULL,
  exercise_type       TEXT NOT NULL CHECK (exercise_type IN
                        ('say_it_back','translation_choice')),
  target_language     TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN
                        ('new','learning','review','relearning')),
  stability           REAL NOT NULL,
  difficulty          REAL NOT NULL,
  due_at              TEXT NOT NULL,
  last_reviewed_at    TEXT,
  reps                INTEGER NOT NULL DEFAULT 0,
  lapses              INTEGER NOT NULL DEFAULT 0,
  fsrs_params_version INTEGER NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  PRIMARY KEY
    (user_id, post_id, line_id, exercise_type, target_language)
);

CREATE INDEX idx_song_study_review_due
  ON song_study_review_state (user_id, due_at);
```

`song_study_review_state` is a projection rebuildable from
`song_study_attempt`. FSRS parameter changes should recompute schedules from
attempt events rather than mutating history or resetting learners.

For `say_it_back`, the `target_language` key slot is the source language because
the learner is practicing the source lyric pronunciation. For
`translation_choice`, the same key slot is the requested target language.

`exercise_id` is a stable opaque identifier synthesized from
`song_study_unit + exercise_type + language`. Attempts remain idempotent by
`(user_id, exercise_id, attempt_number)` even though translation-choice content
is assembled from a unit plus localization row.

### Versions and review continuity

`unit_version` identifies source-line/unit revisions. `localization_version`
identifies target-language generation revisions. Historical
`song_study_attempt.study_pack_version` stores the relevant version for audit
and replay (`unit_version` for `say_it_back`, `localization_version` for
`translation_choice`).

No version is part of the `song_study_review_state` primary key. Regenerating a
unit or one target-language localization must not silently reset a learner's
schedule for the same stable review unit:

```
user_id + post_id + line_id + exercise_type + target_language
```

### Retention

- Store the final say-it-back transcript per attempt.
- Do not store raw audio.
- Do not store interim STT partials.
- Do not store provider debug blobs in D1.
- The transcription endpoint returns a final transcript only; grading and
  persistence happen when that transcript is submitted to the attempts endpoint.
- If temporary debugging artifacts are required, keep them outside D1 with short
  retention and explicit access controls.

### Migration and generation posture

The community database is sharded across live communities, so adding these
tables requires the established per-community D1 migration runner rather than a
one-off migration.

Study packs should be generated lazily per `(post_id, target_language)` on first
eligible request. Do not pre-generate every possible language pair.

For v1, lazy generation MAY create a ready pack directly from the authoritative
community DB lyrics after the caller's access has been confirmed:

- Say-it-back exercises can be created directly from lyric lines.
- Translation-choice exercises require server-generated and validated
  line-level translation content plus distractors before rows are inserted.
- If translation generation is unavailable or invalid, the server MAY still
  return a ready say-it-back-only pack rather than failing the whole study
  experience.
- First-load lazy generation MUST NOT wait on OpenRouter when local
  say-it-back units can be created. It should return a ready say-it-back pack,
  enqueue target-language translation generation, and expose translation-choice
  exercises on later fetches after the async job succeeds.

The server MUST NOT fabricate translation-choice answers on the client and MUST
NOT derive line translations from document-level post localization unless that
localization is explicitly line-aligned.
