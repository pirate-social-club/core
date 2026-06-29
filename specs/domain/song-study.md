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
```

The route is community-scoped, consistent with other post sub-resources.

## Authority

The server is the **sole authority** on study access and content delivery.

- The `access` field on the study payload is the only source of truth for
  whether a caller may study and whether exercise content is present.
- Clients MUST NOT derive study availability or access from the post payload
  shape (e.g. the presence of inline `timed_lyrics`). Such derivation is
  permitted only as temporary client scaffolding and MUST be removed once these
  endpoints exist.
- Study content (lyric text, translations, distractor options) is assembled
  from the authoritative store, gated by entitlement. The server MUST NOT depend
  on the public post payload to source study content.

## Authentication (v1)

`GET .../study` and `POST .../study/attempts` **require authentication** in v1.
Public / logged-out study is a later product decision that would require
token-optional access and explicit public/free entitlement handling. Until then,
unauthenticated callers receive `401 auth_error`, and the `locked` access state
is only ever observed by authenticated, non-entitled callers.

## Access states

`access` is one of `ready`, `locked`, `processing`, `unavailable`.

- **ready** — the caller may study; exercise content is included.
- **locked** — the post exists but access is denied. Returned with HTTP `200`
  and `access: "locked"`, **not** `404`, so the client can render the locked
  study surface with context. Paired with `locked_reason`.
- **processing** — lyrics alignment or study-pack generation is pending. No
  exercise content.
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
   - `exercises.length > 0`;
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

Determinism: distractor selection and ordering are computed server-side,
deterministically, per `(user, post, exercise)` seed, and fixed in the response.
No client-facing seed is exposed.

## Attempts and scheduling

`POST .../study/attempts` validates one attempt **server-side**, records the
attempt as an **event** (not merely the final state, so the schedule can be
recomputed if the algorithm or parameters change), advances the FSRS schedule
for the review unit, and returns the verdict.

- The correct answer is disclosed only once the attempt is spent — a correct
  answer, or an incorrect final attempt (`outcome: revealed`).
- `say_it_back` grading normalizes the transcript under the **target language's**
  tokenization / accent / punctuation policy (whitespace tokenization is not
  sufficient for space-less scripts) and returns a token-level
  matched / missing / extra diff.

### FSRS mapping (server-internal)

Grading is **attempts-based**, deliberately not latency-based for `say_it_back`
(record + STT round-trip pollute timing):

- correct on the first attempt → good / easy
- correct on the second attempt → hard
- failed after `max_attempts` → again

FSRS answers "when should this review unit reappear?". A separate session/high
score concept answers "how did this session go?" — the two MUST NOT be conflated.

## Scope

These endpoints describe **one song's full study pack**. FSRS-scheduled,
cross-song "due today" review sessions are a separate concern and are not
modeled here.
