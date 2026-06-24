# Karaoke Attempts, Rankings & Learning

Status: design contract (reviewed). Implementation gated on this being committed.

Scope: per-community persistence of completed karaoke attempts, per-song rankings, and
the language-learning feedback the results page consumes.

Related:

- [karaoke.md](./karaoke.md) — karaoke as a song-asset capability (lists scoring as a
  non-goal; this doc is the complement).
- `web` `KaraokeResultsView` — the presentational consumer / informal UI spec.

## Principles

- **Per-community store.** Songs belong to communities; rankings are per song. Attempts live
  in the community DB — preserves ownership, locality, deletion, and privacy boundaries.
- **No cross-community leaderboard.** If ever needed, publish a *derived* eligible-best-score
  *projection* into the control plane. That projection is never the canonical attempt store.
- **Server-authoritative result.** The score is computed in the `KaraokeSessionRuntimeDO`;
  the client is never trusted for the persisted value.
- **Finalize is decoupled from teardown.** The DO never blocks teardown on a cross-service
  D1 write. Finalize is idempotent and retried/outboxed, keyed by `(session_id, attempt_id)`.
  Session completion + duplicate delivery ⇒ exactly one attempt.
- **All-time ranking is primary; weekly is derived** with an explicit UTC-week definition.
- **Immutable attempts.** A finalized attempt's score and eligibility never mutate. Identity
  is never snapshotted into an attempt.

## 1. Canonical per-community attempt schema

`db/community-template/migrations/1101_community_karaoke_attempt.sql`

```sql
CREATE TABLE karaoke_attempt (
  id                   TEXT NOT NULL,            -- att_*
  session_id           TEXT NOT NULL,            -- runtime session
  attempt_id           TEXT NOT NULL,            -- runtime attempt within the session
  user_id              TEXT NOT NULL,            -- subject (authenticated). Identity is NOT snapshotted.
  post_id              TEXT NOT NULL,            -- the song post; "per song" == per post
  karaoke_revision_id  TEXT NOT NULL,            -- explicit immutable package revision (see §2)
  content_hash         TEXT NOT NULL,            -- canonical content hash, for integrity/dedup only
  scoring_version      INTEGER NOT NULL,         -- runtime algorithm version (see §2)
  -- Scores as integer basis points (0..10000) for exact ordering/comparison:
  final_score          INTEGER NOT NULL,
  lyrics_score         INTEGER NOT NULL,
  timing_score         INTEGER,                  -- nullable: no measurable timing
  timing_trend         TEXT NOT NULL,            -- early|late|mixed|on_time
  scored_line_count    INTEGER NOT NULL,
  total_line_count     INTEGER NOT NULL,
  uncertain_line_count INTEGER NOT NULL,         -- measurement failures (runtime contract field)
  completion_reason    TEXT NOT NULL CHECK (completion_reason IN
                          ('completed','aborted','expired','provider_failed')),
  rank_eligible        INTEGER NOT NULL CHECK (rank_eligible IN (0,1)),  -- derived at write (§3)
  completed_at         TEXT NOT NULL,            -- ISO UTC; authoritative for weekly + tie-break
  created_at           TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (session_id, attempt_id)                -- idempotency key (§4)
);

CREATE INDEX idx_karaoke_attempt_rank
  ON karaoke_attempt (post_id, rank_eligible, karaoke_revision_id, scoring_version, final_score DESC);
CREATE INDEX idx_karaoke_attempt_window
  ON karaoke_attempt (post_id, rank_eligible, completed_at);
CREATE INDEX idx_karaoke_attempt_user
  ON karaoke_attempt (post_id, user_id, completed_at);
```

Per-line learning detail (`karaoke_attempt_line`) is a later slice (§8); rankings do not
need it. The results page's "what to practice" runs off the live session summary until then.

## 2. Stable revision + scoring version

- `scoring_version` — integer constant exported by `@pirate/karaoke-runtime`
  (`KARAOKE_SCORING_VERSION`). Bumped on any change to weights/algorithm that moves scores.
- `karaoke_revision_id` — an **explicit, immutable package revision identifier** assigned when
  a karaoke package version is produced. It is the public identity used for comparability.
  It is **not** a content hash: hash composition is easy to change accidentally, and
  instrumental replacement can have licensing implications beyond byte identity.
- `content_hash` — a canonical content hash stored **alongside** the revision id, used only
  for integrity verification and dedup. Never the public revision identity.
- **Comparability rule:** rankings compare only attempts sharing the post's **current**
  `(karaoke_revision_id, scoring_version)`. Older attempts remain as history but leave the
  active board. Enforced at query time (no backfill on a bump).
- Requires `getPostKaraoke` to expose `karaoke_revision_id` (+ `content_hash`); it does not today.

## 3. Eligibility + completion reason

`completion_reason`: `completed` (reached end), `aborted` (left early), `expired`
(token/timeout), `provider_failed` (terminal STT failure). Only `completed` is eligible.

`rank_eligible` is computed once at finalize and stored, so ranking is a flat filter.
`rank_eligible = 1` iff **all** of:

- `completion_reason = 'completed'`, AND
- measured lines `m = total_line_count - uncertain_line_count`, with `m >= 5`
  (`MIN_MEASURED_LINES`; also guarantees a positive denominator), AND
- `scored_line_count / m >= 0.85` (`MIN_COVERAGE`, v1).

Revision/version currency is enforced at **query** time (not baked into `rank_eligible`), so a
revision/version bump cleanly retires old entries without a backfill.

## 4. Idempotent finalize / upsert

- At session end the DO computes the summary and writes a finalize record to a **durable
  outbox** (DO SQLite), then returns from teardown. Teardown never awaits the D1 write.
- A finalizer (alarm/queue) delivers the finalize message (full summary) to the community DB,
  retrying with backoff until acked.
- The DB write is **insert-once**, keyed by `(session_id, attempt_id)`:
  ```sql
  INSERT INTO karaoke_attempt (...) VALUES (...)
  ON CONFLICT (session_id, attempt_id) DO NOTHING;
  ```
  A finalized attempt's score and eligibility are immutable. On a conflict, the finalizer
  re-reads the existing row and **compares it against the delivered immutable payload**; an
  exact match is a successful idempotent no-op, a **mismatch raises an alert** (it indicates a
  regrade/bug, never a silent overwrite). Idempotency must not become silent regrading.
- A new sing is a new `attempt_id`.

## 5. Ranking semantics + best-per-user query (all-time, primary)

- **Best per user**: a user's leaderboard score is their single best eligible `final_score`.
- **Tie-break**: `best_reached_at` — the **earliest** `completed_at` at which the user reached
  that best score. Deterministic, rewards incumbency, and does not incentivize churn or fewer
  attempts.
- **Competition ranking** (`1, 2, 2, 4`): tied scores share a rank; the next rank skips.
- **Percentile is server-computed** from rank + total; the client never infers it.

```sql
WITH best AS (
  SELECT user_id, final_score, completed_at,
         ROW_NUMBER() OVER (PARTITION BY user_id
           ORDER BY final_score DESC, completed_at ASC) AS rn
  FROM karaoke_attempt
  WHERE post_id = :post AND rank_eligible = 1
    AND karaoke_revision_id = :rev AND scoring_version = :ver
)
SELECT user_id, final_score AS best, completed_at AS best_reached_at
FROM best WHERE rn = 1
ORDER BY best DESC, best_reached_at ASC
LIMIT :limit;
```

Server-side rank/percentile (competition rank; `best_reached_at` breaks score ties so rank is
total and deterministic):

```
rank          = 1 + (number of users whose (best, best_reached_at) strictly precedes mine)
top_percent   = ceil(rank / total_ranked * 100)          -- "Top N%"
```

## 6. Weekly boundary (derived, explicit)

Weekly = **best eligible attempt *completed during* the UTC week**, NOT the all-time best
shown during the week. Week = `[Monday 00:00:00Z, next Monday 00:00:00Z)`. Same query as §5
plus `AND completed_at >= :week_start AND completed_at < :week_end`. Build all-time first.

## 7. API responses

Identity is a **server-produced public projection**, never raw profile fields and never
snapshotted into attempts:

```
identity = { user_id, display_name, handle, avatar_ref, visibility }
visibility ∈ { visible | anonymized | hidden }
```

- `GET /communities/{c}/posts/{p}/karaoke/leaderboard?scope=all_time|weekly&limit=`
  → `{ scope, scoring_version, karaoke_revision_id,
       your_rank, total_ranked, your_top_percent,
       entries: [{ rank, top_percent, score, identity }] }`
  Scores are basis points (0..10000); the client renders `/100`.
- `GET /communities/{c}/posts/{p}/karaoke/attempts?user=me`
  → `{ personal_best, attempts: [{ id, completed_at, score, rank_eligible }] }`

Identity resolution + moderation (server-side):

- Apply community bans/suspensions and global account deletion: such users are `hidden`.
- Viewer **blocking** anonymizes or hides affected entries **consistently**, while
  **preserving rank numbers** (a blocked user still occupies their rank; only identity is
  masked). Rank integrity does not leak through moderation.
- `anonymized` returns a stable placeholder (no handle/avatar); `hidden` omits identity fields
  but keeps the rank slot.

## 8. Retention / deletion / transcript policy

- **Audio**: never stored (existing hard-lock `karaoke_audio_retention = 'not_stored'`).
- **Attempt rows**: community-scoped — deleted on community deletion (cascade) and on user
  deletion (delete that user's attempts). No identity snapshot; no control-plane copy of
  identity.
- **Transcripts**: default **NOT stored**. If `karaoke_attempt_line` is added for review,
  store **normalized missed-word identifiers**, not raw transcript, unless an explicit opt-in
  retention policy is set. Phoneme/pronunciation claims only with genuine acoustic assessment;
  until then UI says "not recognized", never "mispronounced".

## 9. API-runtime rollout compatibility

Ordered; each step backward-compatible:

1. **API `karaoke-runtime` parity** — add `uncertainLineCount` and export
   `KARAOKE_SCORING_VERSION`. (Web copy already has `uncertainLineCount`; legacy snapshots
   default it to 0.) **This step only — no persistence until this spec is committed/reviewed.**
2. `getPostKaraoke` exposes `karaoke_revision_id` (+ `content_hash`).
3. Migration `1101` adds `karaoke_attempt` (template + apply to live communities).
4. DO finalize → outbox → insert-once. Finalizer tolerates a missing `uncertain_line_count`
   from an older runtime (treat as 0) during the rollout overlap.
5. Read endpoints (§7).
6. Web: wire `KaraokeResultsView` to the read endpoints; route transitions to it on `ended`.

A `scoring_version` bump is coordinated with deploy; the query's version filter retires
pre-change attempts automatically.

## Resolved decisions

- Revision identity: explicit immutable `karaoke_revision_id`; `content_hash` stored alongside
  for integrity/dedup only.
- Tie-break: earliest `best_reached_at`.
- Coverage: `scored / (total - uncertain) >= 0.85`, with `>= 5` measured lines (v1).
- Identity: server projection with `visibility`; moderation/blocking preserves rank numbers;
  no identity snapshot in attempts.
- Idempotency: `ON CONFLICT DO NOTHING` + payload compare + alert on mismatch (no regrade).
- Ranking: competition rank (1,2,2,4); server-computed percentile.

## Open (non-blocking) questions

- `karaoke_revision_id` issuance: where the package-version id is minted (asset pipeline?).
- Avatar/handle source for the identity projection, and the exact `anonymized` placeholder.
