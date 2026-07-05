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
   - `exercises.length` may be zero when the learner is caught up for this
     song;
   - each exercise carries its content (lyric / `reference_text` /
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

`POST .../study/attempts` validates one attempt **server-side**, records the
attempt as an **event** (not merely the final state, so the schedule can be
recomputed if the algorithm or parameters change), advances the FSRS schedule
for the review unit, and returns the verdict.

- Attempt writes MUST be idempotent: an equivalent retry MUST return the
  original result and MUST NOT double-record an event or double-advance FSRS,
  and conflicting payload reuse under the same key MUST be rejected. The client
  supplies an `idempotency_key`, and the durable idempotency guarantee rests on
  `(user_id, idempotency_key)`.
- Attempt numbers are scoped to a showing. First-learn attempts omit
  `review_session_id` and use the implicit `learn` session. Due review attempts
  echo the `review_session_id` returned by `GET /study`, allowing attempt 1 in a
  review to coexist with attempt 1 from first-learn. The server also enforces
  `(user_id, exercise_id, review_session_id, attempt_number)` to reject duplicate
  attempt numbers inside the same showing.
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

## Scope

These endpoints describe **one song's study queue**: first-learn exercises not
yet attempted by the learner plus due FSRS reviews for this song. Cross-song
"due today" review sessions are a separate concern and are not modeled here.

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
  review_session_id  TEXT NOT NULL DEFAULT 'learn',
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
  UNIQUE (user_id, exercise_id, review_session_id, attempt_number),
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
`song_study_unit + exercise_type + language`. Attempt numbers are unique only
inside `(user_id, exercise_id, review_session_id)` so a due review can reuse
attempt 1 without colliding with first-learn.

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

# Addendum: Review Model & Rollout (2026-07-05)

This addendum supersedes the one-and-done read model and specifies the review
session rollout. It is written as a **staged rollout spec**, not a design
survey. The selected implementation keeps `attempt_number` as a request field
and scopes it with `review_session_id`.

## 1. Current state

- Attempts are already append-only events and already advance
  `song_study_review_state` (`state`, `stability`, `difficulty`, `due_at`,
  `reps`, `lapses`) on every accepted attempt.
- `review_state` key is `(user_id, post_id, line_id, exercise_type,
  review_language)`, where `review_language` is the **source** language for
  `say_it_back` and the **target** language for `translation_choice`. The two
  exercise types for one line therefore already occupy distinct rows and
  schedule **independently** — this is a property to preserve, not to build.
- `GET /study` is **one-and-done**: it excludes any exercise the user has ever
  attempted (`NOT EXISTS song_study_attempt`). It never reads `due_at`, so the
  FSRS write side is currently dead weight and no line is ever re-served.
- Two durable uniqueness constraints existed on `song_study_attempt` before
  this addendum:
  `UNIQUE(user_id, idempotency_key)` and `UNIQUE(user_id, exercise_id,
  attempt_number)`. The **second** is what makes re-serving impossible: a second
  sitting would replay `attempt_number = 1` and hit a 409.

## 2. Target read path

`GET /study` selects **due reviews ∪ first-learn**, in that order:

- Due reviews are read from `song_study_review_state` where `due_at <= :now`,
  joined to the current unit/localization rows for the same
  `(post_id, line_id, exercise_type, review_language)`.
- Each due exercise carries a `review_session_id` minted from the review unit
  and the due timestamp:
  `review:<line_id>:<exercise_type>:<review_language>:<due_at>`.
- First-learn exercises keep the current `NOT EXISTS(song_study_attempt)` filter
  and omit `review_session_id`.
- Future-due rows are hidden. A caught-up song returns `access: "ready"` with an
  empty `exercises` array in v1; a richer `session.next_due_at` field can be
  added later without changing attempt semantics.

## 3. Attempt identity change

- **Keep** `UNIQUE(user_id, idempotency_key)` as the durable retry guard.
- Rebuild `song_study_attempt` to add `review_session_id TEXT NOT NULL DEFAULT
  'learn'`.
- Replace `UNIQUE(user_id, exercise_id, attempt_number)` with
  `UNIQUE(user_id, exercise_id, review_session_id, attempt_number)`.
- First-learn submissions omit `review_session_id` and use `learn`.
- Review submissions MUST echo the fetched `review_session_id`. The server
  recomputes the expected ID from the current `song_study_review_state.due_at`
  and rejects stale, future, or forged IDs.

## 4. Contract

`GET /study` stays **idempotent and side-effect-free** (it is a read of "what is
due," not a session mint):

```
GET /study  (access: "ready")
{
  access: "ready",
  exercises: [
    { exercise_id, type, ..., review_session_id?: string }
  ]
}
```

`POST .../study/attempts`:

```
{
  exercise_id, type,
  review_session_id?,    // only for due review exercises
  attempt_number,        // 1-based index inside this first-learn/review session
  idempotency_key,
  selected_option_id | transcript
}
→ { exercise_id, outcome, attempts_remaining, feedback?, next_review_hint? }
```

## 5. Session builder

The server owns session composition inside `GET`:

- Serve due reviews first, ordered by `due_at`, `line_index`, exercise sort,
  then exercise id.
- Then serve first-learn exercises ordered by `line_index`, exercise sort, then
  exercise id.
- Per-type scheduling stays **independent** (§1); co-serving `say_it_back` and
  `translation_choice` for the same line is a **builder policy** over two
  independently-due rows, not a schema commitment. Difficulty/lapse-weighted
  ordering is a later refinement.

## 6. Rollout (normative order)

1. **Deploy code dormant behind a read/write gate.** The attempt path must not
   write `review_session_id` until every shard has the rebuilt table.
2. **Regenerate the community schema snapshot** so newly provisioned shards get
   the rebuilt `song_study_attempt` shape.
3. **Backfill existing shards** with the table rebuild. This is complete only
   when the new column and scoped unique constraint exist on **all** shards.
4. **Enable review reads and writes.** `GET /study` may now return due exercises
   with `review_session_id`, and `POST /study/attempts` accepts those scoped
   review attempts.

## Landmines

1. **Do NOT offer re-serves before the scoped uniqueness exists everywhere.** A
   shard still enforcing `UNIQUE(user_id, exercise_id, attempt_number)` will
   reject the first due review as a duplicate attempt 1.
2. **This is a live-prod schema change, not pre-users.** Replacing a `UNIQUE` in
   SQLite/D1 is a table rebuild per community shard. Pilot-scale data makes it
   cheap, but sequence it as above.
3. **Review IDs are due-versioned.** A successful review changes `due_at`, which
   invalidates the previous `review_session_id`. This is intentional: stale tabs
   should be rejected rather than recording an out-of-date review against a now
   future-due card.
4. **The FSRS curve is still a v1 placeholder** (fixed stability/difficulty
   constants, `fsrs_params_version`). Reading `due_at` makes those intervals
   **load-bearing** — users will feel them. Calibrate (or at least ensure honest
   "learning" intervals) before marketing "spaced review."
