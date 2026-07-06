# Song streak leaderboard — design contract

Status: **draft, revision 2 (2026-07-05)** — incorporates the first external AI audit. No code,
no migration shipped. All file references re-verified against canonical `api`/`core`/`web` at
`origin/main` on this date.

Related: `core/specs/domain/karaoke-rankings.md` (reviewed, implementation gated on its §9a). This
spec **composes with** it; the karaoke leg consumes that spec's `karaoke_attempt` table and
inherits its eligibility + finalize mechanics rather than forking them.

**Decisions locked (owner, 2026-07-05):**
- **Path A** — Study gains spaced-repetition review sessions as a prerequisite (§2.8). Rationale:
  a streak needs a repeatable daily loop; re-serving due review units is useful even without
  streaks and keeps the karaoke persistence/§9a gate off the critical path. Path B (karaoke as the
  only sustained engine) was rejected as a weaker language-learning story that waits on §9a.
- **Sequence:** Phase 0 (Study review sessions) → Phase 1 (study-backed streak leaderboard) →
  Phase 2 (karaoke persistence + streak leg, after runtime packaging).
- **Karaoke pass threshold stays provisional at 70%** and **must not be frozen** until Phase 2
  samples staging/prod-like honest-pass score distributions (§9). If the observed honest-pass
  median is too low, **lower to 60% before launch** rather than shipping a dead leg.

---

## Revision 2 — what the audit changed (read this first)

The audit surfaced seven findings; all were verified true against the code. The material ones
reshape the design:

1. **Study is not daily-repeatable today (P1).** The study read path
   (`post-study-service.ts:558` `listExercises`) hard-excludes every exercise the user has ever
   attempted — both the say-it-back branch (`:580`) and the translation branch (`:606`) filter
   `NOT EXISTS (… song_study_attempt …)`. There is no FSRS re-review resurfacing, and
   `attemptNumber > max_attempts` throws (`:1778`), so with MCQ `max_attempts = 1` a re-review
   cannot even be submitted. **The study pack is finite and one-pass per `(user, post,
   target_language)`.** A daily study streak therefore needs a new **review path** (Path A,
   §2.8) — otherwise "streak" degrades to a finite launch sprint. This is now the headline
   product decision (§10, Q1).
2. **"Wrong answers count, revealed excluded" was backwards (P1).** Grading
   (`post-study-service.ts:1817`): `outcome = correct ? 'correct' : attemptNumber >=
   max_attempts ? 'revealed' : 'incorrect'`. MCQ has `max_attempts = 1` (`:939`), so **every
   wrong MCQ answer is stored as `revealed`, not `incorrect`.** `'incorrect'` only ever occurs
   on a *non-final* say-it-back attempt. The qualifying predicate is now "any recorded attempt
   row" (§1); the data cannot distinguish "gave up" from "answered wrong," so v1 does not
   pretend to (§2.4).
3. **Karaoke late-delivery could undercount (P1, Phase 2).** Karaoke finalization is
   outboxed/retried and therefore out-of-order; the incremental streak upsert treats any date
   ≤ the materialized `last_qualified_date` as a no-op, so a delayed eligible take that should
   *bridge* an earlier gap would be dropped. The karaoke leg now uses a **recompute-from-ledger**
   write instead of the incremental upsert (§4.2), which is order-independent.
4. **Migration prefix 1117 is taken** by `1117_async_post_publish.sql`. Use the next free
   prefix at implementation time (§3).
5. **Rollout schema race (P2).** "Backfill before deploy" does not cover a shard provisioned
   mid-cutover. Rollout now decouples *code deployed* from *writes enabled* via a gate flipped
   only after 100% shard coverage is verified (§7).
6. **Leaderboard index claim was misleading (P2).** EXPLAIN QUERY PLAN confirms the filter
   index still needs a temp B-tree for the ORDER BY. Fixed with an order-first index + honest
   cost note (§3.2, §5.2).
7. **Moderation/deletion underspecified (P2).** Added explicit deleted/banned/blocked handling
   and deletion cleanup (§5.4).

---

## 0. Product statement

For a given song (post), show a leaderboard of users ranked by a Duolingo-style **daily streak**.
A streak day is earned by **either** studying the song (Song Study MCQ / say-it-back exercises)
**or** completing a karaoke take with a passing grade. The feature targets language learners but
counts karaoke so engagement is balanced across both activity types (e.g. an English speaker who
is a fan of an English song can still hold a streak via karaoke).

**Load-bearing precondition:** a streak is only meaningful if at least one qualifying activity is
*daily-repeatable*. Karaoke naturally is (sing again anytime). Study is **not**, today (finite
one-pass pack). §2.8 and §10-Q1 resolve which repeatable engine v1 launches on.

---

## 1. Definitions (normative)

- **Day** — a UTC calendar date (`YYYY-MM-DD`), derived server-side from the write timestamp
  (`substr(nowIso, 1, 10)`). Rationale in §2.3.
- **Qualified day** for `(user, post, day)` — at least one of:
  - **Study leg:** ≥ `STREAK_MIN_STUDY_ATTEMPTS` (**10**, server constant) recorded study
    attempts on that post that day. A "recorded attempt" is **any** row inserted into
    `song_study_attempt` — `outcome IN ('correct','incorrect','revealed')`, i.e. no outcome
    filter (see §2.4; the data cannot separate "answered wrong" from "gave up"). Correct answers
    are additionally tracked (`study_correct_count`) only to power a future correctness floor
    (§2.4), not to gate v1.
  - **Karaoke leg:** ≥ 1 karaoke attempt on that post that day with `rank_eligible = 1` (per
    karaoke-rankings §3: `completion_reason='completed'`, ≥ 5 measured lines, ≥ 85% coverage)
    **and** `final_score >= STREAK_KARAOKE_PASS_BPS` (**7000** bps = 70%, server constant).
- **Current streak** — count of consecutive qualified days ending at `last_qualified_date`.
- **Alive** — a streak is alive iff `last_qualified_date >= date('now','-1 day')` (UTC). A user
  who last qualified yesterday has until end of today (UTC) to extend. **Death is computed at
  read time** — no cron zeroes rows (§2.5).
- **Effective streak** (what the leaderboard ranks by) — `current_streak` if alive, else 0;
  dead streaks are filtered off the board, not shown as 0.

### 1.1 Ranking + tie-break

- Order: `current_streak DESC, best_streak DESC, streak_started_date ASC, user_id ASC` (longer
  history wins ties; earlier commitment next; `user_id` makes it total/deterministic).
- Competition ranking (`1, 2, 2, 4`) computed server-side (same convention as karaoke-rankings
  §5).
- The response also carries the **viewer's own standing** (even if dead — "streak lost, best
  was N") so the UI renders "you" without a second call.

---

## 2. Decision log

### 2.1 Streak scope: per `(user, post)` — a *song streak*

The ask is a per-song leaderboard, and both activities are post-scoped
(`song_study_attempt.post_id` NOT NULL; karaoke gateway claims carry `postId`). A per-song
streak is the only definition where the board's number and the user's mental model coincide.
The ledger (§3.1) is keyed `(user_id, post_id, activity_date)` and rolls up to community scope
later with no schema change; an account-global streak would additionally need a cross-shard sink
(§2.6) and is deferred.

### 2.2 Both legs are server-authoritative

- Study: correctness is graded server-side in `submitPostStudyAttempt`
  (`post-study-service.ts:1692-1844`); the attempt row *is* the grade.
- Karaoke: the summary is computed inside the session Durable Object
  (`web/packages/karaoke-runtime/src/session.ts:326`, emitted via
  `api/services/api/src/lib/karaoke/cloudflare-effect-runner.ts:101`); the client only receives
  it. Persistence follows karaoke-rankings §4. The client is never in the write path for either
  leg.

### 2.3 Day boundary: UTC, not user-local

No per-user timezone exists anywhere (verified: `users` in
`core/db/control-plane/migrations/0000_control_plane_baseline_postgres.sql` has none; only
event/host-scoped tz columns exist). UTC day chosen for v1: deterministic, zero spoof surface,
no schema addition. Cost: users far from UTC get a shifted day (US-Pacific rolls over late
afternoon local) — a fairness papercut, not a correctness bug (the extend window is always a
full 24h). Both source tables keep full timestamps (`song_study_attempt.created_at`,
`karaoke_attempt.completed_at`), so a later migration to client-supplied IANA tz can recompute
buckets. Deferred (§9-Phase 3).

### 2.4 What "10 exercises" counts: any recorded attempt (not an outcome filter)

Revised after the audit. Because MCQ `max_attempts = 1`, a wrong MCQ answer is stored as
`revealed` (`post-study-service.ts:1817-1819`), and `'incorrect'` only appears on non-final
say-it-back tries. The data does **not** distinguish "answered and got it wrong" from "gave up /
revealed the answer," so v1 counts **every** `song_study_attempt` row for the day (`COUNT(*)`),
which is the honest reading of "did ≥ 10 exercises." Properties:

- Implementable as a pure single-statement counter upsert (§4.1) — race-free under D1's
  serialized writes, no in-transaction read (§4.0).
- Spam-bounded by `UNIQUE (user_id, exercise_id, attempt_number)` + per-localization
  `max_attempts`: one MCQ = at most one row; a say-it-back = at most `max_attempts` rows. The
  finite one-pass pack (§2.8) caps total rows per user/post absent a review path.
- `study_correct_count` (increment on `outcome = 'correct'`) is a **reserved knob**: if
  answer-mashing becomes a problem, a future "≥ 10 attempts of which ≥ K correct" floor turns on
  with no migration. v1 ships the floor **off**. (Only `'correct'` is unambiguous; `'revealed'`
  conflates wrong-and-final with gave-up, so it is never used as a "quality" signal — only as a
  count.)

### 2.5 No daily cron; liveness at read time

The scheduler is an every-minute batch, 30s deadline, concurrency 2
(`api/services/api/src/index.ts` scheduled handler + `scheduled-job-runner.ts`); no daily-cron
precedent, and a fan-out UPDATE over 100+ shards to zero dead streaks is pure liability
(partial failure = wrong boards). Instead the row stores `last_qualified_date`, and both the
board query and the viewer read compute aliveness with `last_qualified_date >= date('now','-1
day')`. Dead rows stop matching; `best_streak` is monotone and survives. **This feature schedules
no work.**

### 2.6 Where the data lives: the community D1 shard

Chosen: **new tables in the per-community D1 shard** (community-template), next free migration
prefix (1117 is now taken — §3). Rationale:

- **Atomicity with the source of truth.** The study leg appends its ledger/streak upserts to the
  *same* buffered write transaction that inserts the `song_study_attempt` row
  (`post-study-service.ts:1791-1829`); attempt and streak can never disagree.
- **Read locality.** The board is per-post; posts live in exactly one shard; the read is one
  shard-local indexed query.
- **Identity convention already fits.** Shards reference central identity as a bare `user_id
  TEXT` with no local users table (`core/db/README.md`; cf. `post_votes`). Handles/avatars are
  hydrated from the control plane at read time (feed-byline pattern; karaoke-rankings identity
  rule).
- **Consistency with the sibling spec.** karaoke-rankings already places `karaoke_attempt` in the
  shard and rejects cross-community aggregation. The streak tables sit beside it.

Rejected: control plane (breaks write atomicity, adds a second write dependency + failure
coupling to every study attempt), Tinybird/analytics (not authoritative, gameable), a DO per
board (a stateful component for one indexed query, invisible to backup/ops tooling).

### 2.7 Leaderboard is streak-only

One number, one ordering, per the ask. `best_streak` / `total_qualified_days` ride along for
display and tie-breaks, not as alternate boards. A karaoke *score* board remains karaoke-rankings'
own surface.

### 2.9 Threshold-vs-SRS tension (surfaced during Phase-1 re-grounding) — REVISIT before Phase 1

Now that Phase 0 makes review the sustaining loop, the fixed `STREAK_MIN_STUDY_ATTEMPTS = 10`
collides with how spaced repetition works. FSRS **deliberately shrinks** daily review volume as a
user masters a song: once first-learn content is exhausted, the number of *due* review items on a
given day is often small (a handful), and the review token is bound to a specific `due_at` so the
same item cannot be re-submitted for credit once reviewed (`isDueReview` + `reviewSessionIdFor`;
this is a good anti-farm control but also means a user cannot pad to 10 by repeating one item).
Consequence: a caught-up learner who does **everything available** may still fall short of 10
attempts and lose the streak — punishing exactly the mastery the product wants, and pressuring
users to cram new songs to keep a streak alive.

**DECISION (owner, 2026-07-05): SRS-honest, via a frozen per-day target.** A plain
`attempts >= min(10, due_now)` predicate has a trap: completing a review advances its `due_at`, so
`due_now` *shrinks during the session* — a user with 3 due reviews could qualify after 2 attempts
if the predicate re-reads the (now smaller) due count, and `due_now = 0` would let zero attempts
qualify. The fix is to **capture the target once and freeze it**:

- On the **first study write** for `(user, post, UTC day)` — the INSERT of the
  `song_engagement_days` row — compute `study_target_count` from the due count read **before this
  attempt** (`due_count_before`):
  - `due_count_before > 0` → `study_target_count = min(10, due_count_before)` (clear the day's
    available review load, capped at 10);
  - `due_count_before = 0` → `study_target_count = 10` (fresh study).
  - Never 0 (the branch guarantees `>= 1`).
- **Store `study_target_count` on the ledger row and never update it for the rest of the day** —
  it is set in the INSERT branch of Statement A and deliberately **omitted** from the ON CONFLICT
  DO UPDATE, so it does not shrink as FSRS advances `due_at`.
- **Qualify when `study_attempt_count >= study_target_count`.**

Implementation notes:
- `due_count_before` **must use the same readiness filters as due-review *serving*, not a naive
  count of `song_study_review_state` rows.** A review-state row can exist for a card that is not
  currently serveable (say-it-back provider unavailable, translation localization not `ready`,
  wrong target language), and counting those would inflate the target above what the user can
  actually clear — leaving an honest learner permanently short (auditor risk #1). So `dueBefore`
  is the count of items **`listDueReviewExercises` would return** for this `(user, post,
  targetLanguage)` at `now` — reuse that function's exact predicate as a `COUNT` (due_at ≤ now
  **and** unit/localization readiness: `say_it_back_status='ready'` for say-it-back,
  `l.status='ready'` + non-null translation/options for translation_choice, matching
  `target_language`). Scope it to the language dimension(s) the payload serves.
- It is a **pre-transaction read**, taken before `upsertReviewState` (inside the tx) mutates
  `due_at`, so it reflects the serveable load *before* this attempt. Reads before the tx are
  allowed (§4.0). Every attempt computes a candidate target and passes it; only the day's first
  write (the INSERT) consumes it, so passing it on later attempts is a harmless no-op.
- Concurrency: two racing first-attempts read the same `due_count_before` and compute the same
  target; one wins the INSERT, the other increments via ON CONFLICT and ignores its target. No
  divergence.
- Schema: adds one column `study_target_count` to `song_engagement_days` (a new table — no
  migration cost, §3.1).

This keeps the product meaning intended: *clear the day's available review load (capped at 10), or
do 10 fresh exercises.* Rejected: fixed 10 (punishes mastery — §2.9 opening); a lower fixed floor
(blunt, still ignores actual review load).

### 2.8 Study repeatability — the prerequisite the audit exposed (Path A vs Path B)

**Problem.** Study today is finite and one-pass (§Revision-2 #1). A daily streak needs a daily
loop. Two ways to get one:

- **Path A — add spaced-repetition review sessions to Study (recommended).** The FSRS state
  needed already exists and is written on every attempt: `song_study_review_state`
  (`due_at`, `state`, `stability`, `reps`, `lapses`; upserted at `post-study-service.ts`
  `upsertReviewState`). It is simply never *read back* into the payload. Path A adds a review
  read path that resurfaces exercises with `due_at <= now` (instead of excluding all attempted),
  plus review-submission semantics so a re-review is acceptable. Concretely this needs:
  1. A review branch in `listExercises` (or a sibling `listDueReviews`) that, given `userId`,
     returns due units/localizations joined to `song_study_review_state` ordered by `due_at`,
     **bypassing** the `NOT EXISTS(attempt)` exclusion.
  2. Re-review submission: the current `attemptNumber > max_attempts` guard (`:1778`) plus
     `UNIQUE(user_id, exercise_id, attempt_number)` block a second pass. Options: (a) scope
     attempt numbering per **review session** (a new `review_session_id` dimension, cleanest,
     small migration to the attempt table), or (b) treat each due review as a fresh attempt with
     a monotonic global `attempt_number` and relax the max-attempts guard for review mode.
     Recommendation: (a) — it keeps first-learn and review analytics separable and makes the
     attempt uniqueness meaningful.
  3. FSRS scheduling on review outcome (already computed by `upsertReviewState`; just exercised
     more than once now).
  This is a **genuine Study feature** — spaced-repetition review — independently valuable and the
  natural next step for a language-learning product. It is the honest way to make a study streak
  sustainable, and it does **not** depend on the gated karaoke work. Its cost is real (a small
  attempt-table migration + read/submit paths + tests) and it is a **hard prerequisite** for a
  study-driven streak; it is not a side effect of this feature.

- **Path B — accept finite study; karaoke is the repeatable engine.** Ship the streak tables and
  make karaoke (Phase 2) the sustained daily loop; study contributes qualified days only while a
  song's fresh content lasts (a few days for a rich song, then exhausted). Consequence: a
  study-only launch is a **finite completion streak**, not a sustained one, and a *sustained*
  streak cannot exist until karaoke persistence + karaoke-rankings §9a are done — making the
  gated karaoke work the critical path.

**DECISION: Path A (owner-locked 2026-07-05).** It (1) makes study a real daily activity a streak
can reward, (2) activates FSRS state already being computed and currently wasted, (3) is unblocked
by the karaoke gate, and (4) matches "language learners" as the stated audience — SRS review *is*
the daily language-learning loop. The schema in §3 is identical under either path (a qualified day
doesn't care which activity earned it), so this decision changed *sequencing*, not the data model.
Phase 0 (§7) is therefore a firm prerequisite for a sustained study streak, not an option.

---

## 3. Data model

New community-template migration `1119_song_streaks.sql` — **next free prefix is `1119`**
(re-verified post-Phase-0: `1117_async_post_publish.sql` and `1118_song_study_review_sessions.sql`
now exist; latest is `1118`, snapshot = 119 migrations). Confirm still-free at implementation time.
Prefix uniqueness is enforced by `core/scripts/check-migration-integrity.mjs`.

Conventions (from 1001/1109): TEXT app-generated ids, `community_id` FK on every table, booleans
as `INTEGER CHECK IN (0,1)`, ISO-string timestamps, calendar dates as `YYYY-MM-DD` strings
(sanctioned by api/AGENTS.md), `ON DELETE CASCADE` to posts (matching `song_study_attempt`).

### 3.1 `song_engagement_days` — daily ledger (auditable base facts, recomputable)

```sql
CREATE TABLE song_engagement_days (
  user_id              TEXT NOT NULL,   -- central user_id, no local FK (shard convention)
  post_id              TEXT NOT NULL,
  community_id         TEXT NOT NULL,
  activity_date        TEXT NOT NULL,   -- YYYY-MM-DD, UTC (§2.3)
  study_attempt_count  INTEGER NOT NULL DEFAULT 0,  -- ANY attempt row (§2.4)
  study_correct_count  INTEGER NOT NULL DEFAULT 0,  -- outcome='correct'; reserved knob (§2.4)
  study_target_count   INTEGER NOT NULL DEFAULT 10, -- frozen day target: min(10,due_before) or 10 (§2.9)
  karaoke_pass_count   INTEGER NOT NULL DEFAULT 0,  -- rank_eligible && >= pass threshold
  qualified            INTEGER NOT NULL DEFAULT 0 CHECK (qualified IN (0,1)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id, activity_date),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (community_id) REFERENCES communities(community_id)
);
CREATE INDEX idx_song_engagement_days_user_post
  ON song_engagement_days (user_id, post_id, activity_date);  -- recompute fold (§4.2)
```

The ledger keeps the streak row **recomputable** (repair + karaoke recompute, §4.2/§7), lets
qualification thresholds be re-derived historically if knobs change, and needs no new facts for a
future community-scope rollup.

### 3.2 `song_streaks` — materialized current standing (the board reads only this)

```sql
CREATE TABLE song_streaks (
  user_id               TEXT NOT NULL,
  post_id               TEXT NOT NULL,
  community_id          TEXT NOT NULL,
  current_streak        INTEGER NOT NULL,
  best_streak           INTEGER NOT NULL,  -- monotone max of current_streak
  last_qualified_date   TEXT NOT NULL,     -- YYYY-MM-DD UTC
  streak_started_date   TEXT NOT NULL,     -- first day of the current run (tie-break/display)
  total_qualified_days  INTEGER NOT NULL,  -- lifetime qualified days (display/tie-break)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (community_id) REFERENCES communities(community_id)
);
-- Order-first so the leaderboard's ORDER BY is served by the index, not a temp B-tree.
-- The alive filter (last_qualified_date >= yesterday) is applied as a residual over the
-- ordered scan and stops at LIMIT; at per-song streak-holder cardinality this is cheap and
-- most top rows are alive. (Audit P2: a filter-first index still sorted; verified via EXPLAIN
-- QUERY PLAN. This index removes the sort at the cost of scanning past any dead high-streak
-- rows, which are rare.)
CREATE INDEX idx_song_streaks_board
  ON song_streaks (post_id, current_streak DESC, best_streak DESC, streak_started_date, user_id);
```

No dead-streak archival table: history is in the ledger; `best_streak` preserves the headline.

---

## 4. Write paths

### 4.0 Hard constraint this design is built around

Routed community writes use `BufferingD1WriteTransaction`
(`api/services/api/src/lib/communities/community-d1-client.ts`): `tx.execute()` buffers and
returns empty; everything flushes as **one atomic, sequentially-executed `batchWrite`** at
commit. So **no statement may branch on another statement's result inside the transaction**, and
every statement must pass `isWriteAllowedStatement` (`api/services/shared/src/sql-read-guard.ts`:
leading `INSERT/UPDATE/DELETE/REPLACE` or write CTE; no bare SELECT, no DDL, no multi-statement
strings). This burned link-submit once (D1 buffered write-tx SELECT trap, fixed 2026-06-22).
Reads that *inform* a write must happen **before** the tx opens; an `INSERT … SELECT` that reads a
row an *earlier statement in the same batch* wrote is legal (sequential execution; the statement
still leads with `INSERT`).

### 4.1 Study leg — extend `submitPostStudyAttempt`'s existing transaction (synchronous, in-order)

Site (re-verified post-Phase-0, 2026-07-05): `submitPostStudyAttempt` is now at
`post-study-service.ts:1955-2126`; its write transaction (`withTransaction(db.client,"write",…)`)
is `2072-2111` — `upsertReviewState` then `INSERT INTO song_study_attempt` (now 17 columns incl.
`review_session_id`) at 2081-2109. Append the two streak statements **after line 2109, before the
`return` at 2110**, inside the same transaction. All validation/`throw` sites precede the tx, and
the idempotency short-circuit (`resultFromAttempt`, 1978-1989) returns *before* entering the tx —
so the streak hook fires **exactly once per real attempt**, never on an idempotent retry. A single
hook here covers **both** first-learn (`review_session_id='learn'`) and validated due-review
submissions — they share this one INSERT path (§0 note; recon §4). Append **two** statements on
**every** recorded attempt (no outcome gate — §2.4; `:isCorrect` = 1 when `outcome='correct'` else
0; `:today = substr(now,1,10)`; `:target` = the frozen day target from §2.9):

**Statement A — ledger counter upsert.** `:target` = the frozen day target computed in app code
before the tx (§2.9): `dueBefore > 0 ? min(10, dueBefore) : 10`. It is consumed **only** by the
INSERT (first write of the day); the ON CONFLICT branch never touches `study_target_count`, so it
cannot shrink as FSRS advances `due_at`. `qualified` is evaluated against the frozen target:

```sql
INSERT INTO song_engagement_days
  (user_id, post_id, community_id, activity_date, study_attempt_count, study_correct_count,
   study_target_count, karaoke_pass_count, qualified, created_at, updated_at)
VALUES (:user, :post, :community, :today, 1, :isCorrect,
        :target, 0,
        CASE WHEN 1 >= :target THEN 1 ELSE 0 END, :now, :now)
ON CONFLICT (user_id, post_id, activity_date) DO UPDATE SET
  study_attempt_count = song_engagement_days.study_attempt_count + 1,
  study_correct_count = song_engagement_days.study_correct_count + :isCorrect,
  -- study_target_count intentionally NOT updated (frozen on first write, §2.9)
  qualified = CASE
      WHEN song_engagement_days.study_attempt_count + 1 >= song_engagement_days.study_target_count THEN 1
      WHEN song_engagement_days.karaoke_pass_count > 0 THEN 1
      ELSE song_engagement_days.qualified END,
  updated_at = :now;
```

**Statement B — streak upsert, gated on the day being qualified** (`INSERT … SELECT` reading the
row Statement A just wrote; inserts 0 or 1 rows).

> **✅ Load-bearing assumption — PROVEN (spike, 2026-07-05).** Statement B reads
> `song_engagement_days` *within the same buffered write transaction* that Statement A just wrote
> it in. This is race-free only if `BufferingD1WriteTransaction` → `shard.batchWrite` executes the
> buffered statements sequentially in one implicit transaction where a later statement sees an
> earlier one's writes. **A spike against real workerd D1** (vitest-pool-workers, the
> `tests/integration/*.integration.ts` harness wired to a real `DB_CMTY_PILOT` + `D1_POOL`
> binding, driving `makeCommunityD1Client(...).transaction("write")` → real
> `runShardWrite` → `D1Database.batch()`) confirmed all three cases: (1) B's `INSERT…SELECT` sees
> a fresh row A `INSERT`ed in the same batch; (2) **the real design** — B observes a `qualified`
> flip A made via `ON CONFLICT DO UPDATE` in the same batch (streak row materializes); (3)
> negative control — B does not fire when A's increment leaves the day sub-threshold. **Therefore
> the cheap two-statement in-transaction study leg (Statement A + Statement B) is valid; the
> recompute fallback below is NOT needed for the study leg.** (Karaoke still uses recompute for a
> different reason — out-of-order delivery, §4.2.)
>
> Phase 1 task: fold a permanent version of this spike into the committed integration suite. It
> requires wiring `d1Databases: { DB_CMTY_PILOT, D1_POOL }` into `services/api/vitest.config.ts`
> (currently absent — which also un-breaks the existing dormant `shard-write.integration.ts`).
>
> *Fallback (retained for reference, not used by the study leg):* keep only Statement A in the
> attempt tx and update `song_streaks` via a second read-then-compute-then-write op after commit
> (idempotent from the ledger; self-heals). One extra round-trip; unifies both legs.

```sql
INSERT INTO song_streaks
  (user_id, post_id, community_id, current_streak, best_streak,
   last_qualified_date, streak_started_date, total_qualified_days, created_at, updated_at)
SELECT d.user_id, d.post_id, d.community_id, 1, 1,
       d.activity_date, d.activity_date, 1, :now, :now
FROM song_engagement_days d
WHERE d.user_id = :user AND d.post_id = :post AND d.activity_date = :today AND d.qualified = 1
ON CONFLICT (user_id, post_id) DO UPDATE SET
  current_streak = CASE
      WHEN excluded.last_qualified_date <= song_streaks.last_qualified_date
        THEN song_streaks.current_streak                                    -- same day / stale: no-op
      WHEN song_streaks.last_qualified_date = date(excluded.last_qualified_date, '-1 day')
        THEN song_streaks.current_streak + 1                                -- consecutive: extend
      ELSE 1 END,                                                           -- gap: reset
  best_streak = MAX(song_streaks.best_streak, CASE
      WHEN excluded.last_qualified_date <= song_streaks.last_qualified_date THEN song_streaks.current_streak
      WHEN song_streaks.last_qualified_date = date(excluded.last_qualified_date, '-1 day') THEN song_streaks.current_streak + 1
      ELSE 1 END),
  streak_started_date = CASE
      WHEN excluded.last_qualified_date <= song_streaks.last_qualified_date THEN song_streaks.streak_started_date
      WHEN song_streaks.last_qualified_date = date(excluded.last_qualified_date, '-1 day') THEN song_streaks.streak_started_date
      ELSE excluded.last_qualified_date END,
  total_qualified_days = song_streaks.total_qualified_days + CASE
      WHEN excluded.last_qualified_date <= song_streaks.last_qualified_date THEN 0 ELSE 1 END,
  last_qualified_date = MAX(song_streaks.last_qualified_date, excluded.last_qualified_date),
  updated_at = :now;
```

Properties: **idempotent within a day** (once qualified, further attempts hit the `excluded <=
existing` no-op branch, so B can run on every attempt with no app-side "did the day flip?" read);
**`total_qualified_days` increments exactly once per date** (the `excluded.last_qualified_date <=
song_streaks.last_qualified_date ? 0 : 1` guard — repeated same-day qualifying attempts add 0);
**race-free** (no app read-modify-write; D1 serializes shard writes; concurrent double-submits
take the same no-op branch, and `UNIQUE(user_id, idempotency_key)` on `song_study_attempt` aborts
true duplicates, rolling back the whole batch); **monotone `best_streak`** by construction.

**Scope limit of the incremental form:** Statement B is correct only for **in-order, forward**
qualification (today ≥ last qualified). The study path always is (writes are synchronous, dated
`today`; older dates only ever come from the repair/seed tool). Any **out-of-order** qualification
must instead use the recompute path (§4.2) — this is exactly why the karaoke leg does not reuse
Statement B.

### 4.2 Karaoke leg — recompute-from-ledger (async, out-of-order safe) — Phase 2

Hard prerequisite: `karaoke_attempt` persistence per karaoke-rankings §4 (DO computes summary →
durable-outbox record at teardown → alarm/queue finalizer delivers to the shard, insert-once on
`UNIQUE(session_id, attempt_id)`). Today **nothing** is persisted (verified: no attempt/score
table in any migration root; the DO outbox is a reconnect buffer teardown wipes; web never POSTs
results), and karaoke-rankings §9a (reproducible runtime dependency; the API still consumes the
runtime via `file:../../../web/packages/karaoke-runtime`) gates that slice. So the karaoke leg is
**Phase 2**.

Because finalization is **outboxed and retried**, deliveries arrive out of order and possibly
late (a take for *yesterday* can land after *today* already qualified). The incremental Statement
B would drop such a bridging day (audit P1 #3). The karaoke finalizer therefore uses a
**read-then-recompute-then-write** sequence (all reads before the write tx — §4.0 compliant):

1. **Read** (pre-tx): does `karaoke_attempt` already contain `(session_id, attempt_id)`? If yes,
   this is a redelivery of an already-applied attempt → stop (exact-once). Otherwise read the
   user's full qualified-day set from the ledger for `(user, post)` (indexed by
   `idx_song_engagement_days_user_post`).
2. **Compute** (app code): the new qualified date `= substr(completed_at,1,10)`; fold the ledger's
   qualified dates ∪ {new date} into `current_streak` (consecutive run ending at the max qualified
   date), `best_streak`, `streak_started_date`, `total_qualified_days`. This is O(distinct days),
   tiny, and **order-independent** — a bridging older date recomputes the whole run correctly.
3. **Write** (one atomic batch):
   - Ledger upsert (karaoke variant of Statement A: `karaoke_pass_count = … + 1`, `qualified =
     1`) — safe to run because step 1 proved this attempt is new, so it cannot double-increment.
   - `song_streaks` upsert with the **recomputed** values (a full `ON CONFLICT DO UPDATE SET
     current_streak = :computed, …`), taking `MAX(best_streak, :computed)` to preserve
     monotonicity even against a concurrent study extend.
   - `INSERT INTO karaoke_attempt (…) ON CONFLICT (session_id, attempt_id) DO NOTHING` — the
     rankings spec's own insert.

Non-passing eligible attempts write only the `karaoke_attempt` insert. `user_id` is the DO's
authenticated `subject` claim (admin/delegated actors already rejected at
`communities-karaoke-session-routes.ts:75-96`). The rankings spec's conflict-mismatch alerting
(§4) is a post-commit read, unaffected.

**Interaction with the study path:** a study extend and a karaoke recompute for the same
`(user, post)` could race. Both take `MAX` on `best_streak`; the study path only ever *advances*
`last_qualified_date` (forward), and the karaoke recompute writes an absolute value derived from
the ledger. The one hazard: a karaoke recompute computing from a ledger snapshot that a
concurrent study upsert then supersedes. Mitigation: the recompute's `current_streak`/`started`
writes are also guarded so they never *lower* a strictly-newer `last_qualified_date` — i.e. the
`song_streaks` upsert's `last_qualified_date = MAX(existing, :computedMax)` and
`current_streak`/`started` are only overwritten when `:computedMaxDate >= existing
last_qualified_date`; when the existing row is already newer, only `best_streak = MAX(...)` and
`total_qualified_days` reconciliation apply. Because both writers are serialized by D1 and both
derive from the same ledger (which each has already updated in-batch), the fold converges. This
guard belongs in the Phase-2 implementation and its test matrix (§8).

**Rejected alternative:** a client-triggered "claim" endpoint. Loses credit when the tab dies
before claiming and duplicates a delivery mechanism the rankings spec already commits to.

### 4.3 No triggers

All derivation is in explicit statements at the two write sites. Triggers would hide writes from
`isWriteAllowedStatement` review, complicate the final-form snapshot generator, and violate the
codebase's visible-writes style.

---

## 5. Read path + API

### 5.1 Endpoint

`GET /communities/:communityId/posts/:postId/streaks/leaderboard?limit=50`

- New route module `api/services/api/src/routes/communities-streak-routes.ts`, registered from
  `communities.ts` like `registerCommunityStudyRoutes` (`routes/communities.ts:95`), plus the
  mandatory `ROUTE_COVERAGE.md` entry (`check:hygiene` fails otherwise).
- Auth v1: same policy as the study payload GET (authenticated community read). A public/logged-out
  variant can follow the karaoke-CTA public-payload precedent later.
- `limit` default 50, max 100.
- **The read path is NOT behind the write-enable gate** (§7). The gate guards only the streak
  *write* (Statement A/B); the leaderboard/viewer reads run unconditionally and simply return an
  empty board while tables are freshly provisioned and unpopulated.

### 5.2 Query (one shard round-trip for the board, one PK read for the viewer)

```sql
SELECT user_id, current_streak, best_streak, streak_started_date, total_qualified_days, last_qualified_date
FROM song_streaks
WHERE post_id = :post
  AND last_qualified_date >= date('now', '-1 day')   -- alive filter (§1)
ORDER BY current_streak DESC, best_streak DESC, streak_started_date ASC, user_id ASC
LIMIT :limit;
```

Served by `idx_song_streaks_board` (order-first, §3.2): the ORDER BY needs **no temp B-tree**; the
alive predicate is a residual filter over the ordered scan that stops at `LIMIT`. Honest cost: a
dead high-streak row is scanned-and-skipped before reaching alive rows below it — rare and cheap
at per-song streak-holder cardinality. If a post ever accumulates many dead high-streak holders,
revisit with a periodically-maintained `alive` column (which would reintroduce scheduled work —
not worth it now). `date('now',...)` is UTC in SQLite/D1; the service passes the same `:today` it
uses on the write side to keep read/write bucketing identical.

The viewer's row is a separate PK `SELECT` (returned even when dead, with `alive:false`), plus the
viewer's `song_engagement_days` row for `:today` (a third PK read) for "3/10 today" progress.

### 5.3 Response shape (contracts)

Types added to `core/specs/api/src/components/schemas/**`, then contracts regenerated (core
generator → `api/services/contracts` `bun run generate` / `check:fresh`; the generated
`services/contracts/src/index.ts` is never hand-edited). Reuse `PublicLeaderboardIdentity` from
karaoke-rankings §10.2 (handle/display/avatar, resolved at read time — never snapshotted).

```
SongStreakLeaderboard {
  postId, date,                    // UTC date the board was computed for
  entries: [ { rank, identity: PublicLeaderboardIdentity, currentStreak, bestStreak,
               totalQualifiedDays, streakStartedDate, isViewer } ],
  viewer: { alive, currentStreak, bestStreak, totalQualifiedDays,
            qualifiedToday, studyAttemptsToday, karakePassedToday } | null,
  totalActiveStreaks
}
```

### 5.4 Identity, moderation, deletion (audit P2 #7)

Mirrors karaoke-rankings' identity/ordering rules; identity is resolved at read time from the
control plane, never snapshotted into shard rows.

- **Deleted accounts / unresolvable identity:** a `user_id` that no longer resolves is **excluded**
  from `entries` and its rank is not emitted. Because ranks are computed server-side *after*
  identity resolution, competition ranking is assigned over the resolvable set only (no gaps from
  hidden users).
- **Banned users:** excluded per the community's existing moderation/membership state (the same
  predicate the feed/rankings surfaces use); a banned user is filtered before rank assignment.
- **Blocked users (viewer-specific):** honor the viewer's block relationships (feed convention) —
  a blocked user is omitted from *that viewer's* board.
- **Fetch-more headroom:** because identity/moderation filtering happens post-query, the service
  reads `LIMIT :limit + buffer` rows and trims after filtering, so a full page of visible entries
  survives a few hidden ones (same technique as the feed).
- **User deletion / leave-community cleanup:** shards intentionally have no `users` table and no
  user-scoped FK, so there is no cascade on account deletion; read-time exclusion is the primary
  mechanism. A periodic/opportunistic cleanup of `song_streaks`/`song_engagement_days` rows for
  departed users can piggyback on existing membership-cleanup jobs (`community_jobs`), but is
  **not** required for correctness because dead/absent identities never render. Post deletion
  already cascades (`ON DELETE CASCADE` to `posts`).

---

## 6. Anti-gaming review

- **Study spam:** attempt counting is bounded by `UNIQUE(user_id, exercise_id, attempt_number)` +
  per-localization `max_attempts` + the finite one-pass pack (§2.8). Under **Path A** (review
  sessions) the daily ceiling is the number of *due* reviews, which FSRS caps naturally — a user
  cannot mint unlimited due items. Residual risk: mashing ~10 wrong answers across a handful of
  exercises in a minute; accepted for v1 (it is engagement, of a sad kind). `study_correct_count`
  is the pre-provisioned correctness-floor knob (§2.4). Not counted: `transcriptions` calls or
  payload GETs — only `song_study_attempt` rows.
- **Karaoke spam:** the pass gate inherits rank-eligibility (server STT, ≥5 measured lines, 85%
  coverage, completed); scores are never client-supplied. Replay is blocked by
  `UNIQUE(session_id, attempt_id)` plus the step-1 pre-write existence check (§4.2).
- **Clock games:** all timestamps are server-generated (`nowIso()`); UTC bucketing takes no client
  input.
- **Multi-account:** out of scope; same exposure as votes/memberships, unchanged.
- **Thresholds** (`STREAK_MIN_STUDY_ATTEMPTS = 10`, `STREAK_KARAOKE_PASS_BPS = 7000`) live in one
  server module beside the write sites; they are *qualification* inputs evaluated at write time, so
  changes apply forward only (no retro-requalify) — the honest streak behavior. Documented in the
  module docstring.

---

## 7. Rollout plan (phased; schema-race-safe)

### Phase 0 — study repeatability (locked prerequisite; §2.8)

Review read path + review-session submission semantics + tests. Independently shippable and
independently valuable (spaced-repetition review for Study). **Firm prerequisite for a *sustained*
study streak** — Phase 1's leaderboard is only as alive as Study's daily loop, which this phase
creates. Ships and can be validated on its own before any streak code exists.

### Phase 1 — streak tables + study leg + leaderboard

0. **De-risk the in-batch read (§4.1 ✅ DONE 2026-07-05).** Spike against real workerd D1 proved
   Statement B sees Statement A's write (incl. an `ON CONFLICT` `qualified` flip) inside one
   `batchWrite`. **Study leg uses the two-statement in-tx path.** Remaining Phase-1 task: wire
   `d1Databases` into the committed `vitest.config.ts` and add a permanent regression version of
   the spike (also un-breaks `shard-write.integration.ts`).
1. **core PR:** `1119_song_streaks.sql` (§3) + this spec to reviewed status. CI:
   migration-integrity + fresh-SQLite apply cover it.
2. **api PR (deploys code dormant):**
   - Regenerate the community schema snapshot
     (`api/services/api/scripts/generate-community-schema-snapshot.ts`) + mirror the migration into
     `test-fixtures/db/community-template/migrations/` (satisfies
     `check-community-schema-guards.ts`; new tables are not on the guarded API-queried-table list).
     **Shipping the regenerated snapshot means every *newly provisioned* shard has the tables from
     this deploy forward**, closing the "provisioned mid-cutover" race for new shards.
   - Statements A+B in `submitPostStudyAttempt` (§4.1), **guarded by a write-enable gate**
     (community `study_streak_enabled`-style flag or a global env flag), defaulting **off**.
   - Leaderboard route + contracts (core schema source first, then contracts regen).
3. **Shard DDL backfill (existing shards):** apply the migration to all provisioned shards using
   the `1109` study-backfill recipe (103 shards, 2026-07-03) — direct-to-D1
   (`wrangler d1 execute` / D1 HTTP API), because the shard RPC write path rejects DDL by design;
   record `schema_migrations` per shard. Then run a **per-shard `schema_migrations` sweep asserting
   100% coverage**.
4. **Flip the write-enable gate** only after step 3's sweep passes. This decouples *code live* from
   *writes active*, so no attempt-path batch can hit a shard lacking the tables:
   - New shards: covered by the snapshot (step 2).
   - Existing shards: covered by the backfill (step 3) verified before the flip (step 4).
   - The audit's mid-cutover race is closed on both sides.
   - **Sustainability dependency:** the study streak is only daily-repeatable where Phase 0's
     due-review serving is on (`SONG_STUDY_DUE_REVIEW_SERVING_ENABLED`, default **false** —
     recon §4). Confirm that flag is enabled in prod for target communities *before/with* the
     streak launch, else a mastered song's streak silently reverts to finite one-pass behavior.
5. **Optional history seed (recommended):** one-off script (pattern
   `scripts/community-document-providers-migration.ts`, dry-run/apply, iterates shards) rebuilding
   `song_engagement_days` from historical `song_study_attempt` (`GROUP BY user_id, post_id,
   substr(created_at,1,10)`, counting all rows) and folding `song_streaks` per user. Deterministic
   + idempotent (recompute-and-replace). Doubles as the **repair tool** for a single (user, post).
   Without it everyone starts at 0 on launch day (acceptable).
   *Caveat (frozen-target, §2.9):* historical point-in-time due counts cannot be reconstructed, so
   the seed uses the fresh-study target of 10 for every historical day (a day qualifies iff ≥ 10
   attempts). This under-credits days that were really small-review days; acceptable for a one-time
   backfill, and live days from launch forward use the true frozen target. The **repair tool** for a
   *live* (user, post) reads the actual stored `study_target_count` per day and does not re-derive
   it, so repair stays exact.
6. **web PR:** leaderboard UI on the song page + streak chip ("day N", "3/10 today") from `viewer`.

### Phase 2 — karaoke leg

1. Lift karaoke-rankings §9a: publish/pin `@pirate/karaoke-runtime` (or relocate to a shared
   monorepo path), repoint the API dep, record the bundled runtime version per build. Prerequisite
   the rankings spec already demands; valuable independent of streaks.
2. Implement karaoke-rankings §4 finalize (DO durable outbox + finalizer + `karaoke_attempt`
   migration at the next free prefix — not the stale `1101`).
3. Add the recompute-from-ledger karaoke write (§4.2) to the finalizer.
4. web: results screen shows "streak extended!" when the delivered attempt qualified; rankings
   §10.4 ineligibility copy applies.

Phase 2 needs no second streak migration (`karaoke_pass_count` is already in §3.1).

### Phase 3 (deferred)

Per-user timezone bucketing (§2.3); streak freezes (a `streak_freezes` table + consumption at the
read-time aliveness check — the read-time design makes this purely additive); community-scope
rollup; public/logged-out board; cross-community projections (rejected here and in
karaoke-rankings).

---

## 8. Test plan

- **Streak math (unit, real SQLite):** table-driven over Statement B's CASE lattice — first
  qualification, same-day repeat, consecutive extend, gap reset, stale-date no-op, best-streak
  monotonicity, `total_qualified_days` increments.
- **Karaoke recompute (unit):** out-of-order delivery — today then a bridging *yesterday* take →
  streak recomputes to include the bridge; late duplicate `(session_id, attempt_id)` → exact-once
  no-op; study-extend racing a karaoke recompute → `best_streak`/`last_qualified_date` converge and
  never regress.
- **Write-tx guards:** a `*-write-tx-guard.test.ts` (pattern:
  `community-settings-write-tx-guard.test.ts`) proving every appended statement passes
  `isWriteAllowedStatement` and the study path does **zero** reads inside the transaction.
- **Predicate (audit P1 #2):** a wrong MCQ answer (stored `revealed`) still increments
  `study_attempt_count` and can reach qualification; `study_correct_count` counts only `correct`.
- **Route tests:** `tests/routes/<group>/routes.test.ts` + `auth.test.ts`; ordering/tie-break
  determinism; alive-filter boundary (qualified yesterday vs day-before); viewer-dead-streak shape;
  limit clamping; hidden-identity trimming with `+buffer` fetch (§5.4).
- **Idempotency:** double-submit same idempotency_key (whole batch rolls back, count unchanged).
- **Backfill/seed:** dry-run diff on a staging shard against the say-it-back fixture
  (study-say-it-back staging fixture, 2026-07-03); assert seeded streaks equal the unit-test fold.
- **Repeatability (Path A):** after Phase 0, a due review resurfaces and a second-day attempt is
  accepted and counts — proving the streak can actually extend past pack exhaustion.
- **Staging e2e:** drive ≥10 attempts on staging, read the board, roll the date, assert extend;
  gap a day, assert the entry drops while `viewer.bestStreak` survives.

## 9. Constants

`STREAK_MIN_STUDY_ATTEMPTS = 10`, `STREAK_KARAOKE_PASS_BPS = 7000` — one server module beside the
write sites; forward-only semantics (§6).

`STREAK_KARAOKE_PASS_BPS` is **provisional (owner-locked 2026-07-05)** and is a Phase-2-only
constant (the study leg does not read it). It **must not be frozen** until Phase 2 samples
honest-pass `final_score` distributions on staging/prod-like data. Gate:
- Sample eligible (`rank_eligible = 1`) `final_score` values from real singers on representative
  songs; compute the honest-pass median.
- If the median sits comfortably above 7000, keep 70%.
- If it is too low (a meaningful share of genuine, complete takes fall under 7000), **lower to
  6000 (60%) before launch** rather than shipping a leg that almost never qualifies.
- Do **not** launch the karaoke leg with a threshold that yields a near-empty qualification rate;
  a dead leg is worse than shipping karaoke a cycle later.
This gate is a hard exit criterion for Phase 2, not a nice-to-have.

## 10. Product-owner decisions

**Resolved (owner, 2026-07-05):**
1. **Study repeatability — Path A (§2.8).** Add spaced-repetition review sessions so study is
   genuinely daily; keeps the karaoke §9a gate off the critical path. Sequence locked: Phase 0 →
   Phase 1 → Phase 2.
2. **Karaoke pass threshold — provisional 70%, freeze gated (§9).** Sample honest-pass
   distributions in Phase 2; lower to 60% before launch if the median is too low; never ship a
   dead leg.

**Defaults chosen, still open to override before the relevant phase:**
3. **10 attempts / day** (~3–5 min of study). Default 10.
4. **Counting model (audit P1 #2):** v1 counts *any* attempt row (can't distinguish wrong-answer
   from gave-up). Acceptable, or hold for a data change that separates them? Default: count all.
5. **UTC day** acceptable for launch (§2.3)? Default yes.
6. **Leaderboard visibility** — members-only v1 vs public. Default members-only.
7. **Threshold-vs-SRS (§2.9) — RESOLVED (owner, 2026-07-05): frozen per-day target.** A study day
   qualifies when `study_attempt_count >= study_target_count`, where `study_target_count` is
   captured **once on the day's first study write** as `dueBefore > 0 ? min(10, dueBefore) : 10`
   and never mutated thereafter (so it cannot shrink as FSRS advances `due_at`). `dueBefore` is the
   count of **serveable** due reviews (same readiness filters as due-review serving — §2.9), read
   pre-transaction. This replaces the earlier `min(10, due_today)` shorthand, which had a
   shrinking-target bug (completing reviews lowers the live due count) and let zero-due days
   qualify with zero attempts. Changes the `qualified` predicate + adds one ledger column (a new
   table — no migration cost), not the streak schema.
