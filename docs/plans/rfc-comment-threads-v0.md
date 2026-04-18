# RFC: Comment Threads v0

## Status

Partially implemented. Backend v0 is in place in `pirate-api`; client degraded-read fallback is not yet implemented in `pirate-web`.

Implemented backend scope:

- Community DB migrations `1024` through `1028`
- Control-plane `0037_control_plane_comment_projections`
- Comment store/service/routes with closure-table writes and cursor pagination
- Comment moderation/report integration into the existing moderation workflow
- `community_jobs` worker loop with durable retry for `comment_projection_sync`
- Real Swarm publication for:
  - `comment_body_mirror`
  - `thread_snapshot_publish`
  - signed feed updates via Bee + `bee-js`
- Public read surfaces now expose latest Swarm thread refs:
  - `GET /communities/:communityId/posts/:postId/comments`
  - `GET /comments/:commentId/replies`
  - `GET /comments/:commentId/context`
  - `GET /posts/:postId`

Still not implemented:

- Client-side degraded fallback in `pirate-web` that actually reads from Swarm when Pirate is unavailable
- Comment edit flow
- Moderation signal ingestion beyond user reports
- Preview-reply slices on top-level comment nodes
- Bee retry jitter / dead-letter operational surface

---

## Goals

1. First-class comments table, separate from posts, supporting arbitrarily deep reply trees.
2. Lazy branch expansion: load top-level comments first, expand subtrees on demand.
3. Closure-table reads for subtree, context, and breadcrumb queries without recursion.
4. Comment moderation integrated into the existing moderation workflow, not a parallel system.
5. Thread snapshots mirrored to Swarm for censorship-resistant public read fallback.
6. All writes remain API-mediated; Swarm is async and never blocks comment submission.

## Non-Goals

- Write resilience via Swarm or relay. That is a separate relay problem.
- Live/real-time comment streaming. Polling or cursor pagination is sufficient for v0.
- "Best" sort with stored ranking scores. Use query-time `score` ordering until scale forces caching.
- Rate limiting as schema. That is a policy decision, not a database concern.

---

## Repo Ownership

| Change area | Repo |
|---|---|
| Community DB migrations, comment store, comment service, comment routes, Swarm job integration | `pirate-api/` |
| Control-plane migration for `comment_projections` | `pirate-api/` (control-plane DB is owned here) |
| Contract types (`Comment`, `CommentThreadSlice`, etc.) | `pirate-api/services/contracts/` (regenerated from specs) |
| Comment UI, thread expansion, lazy branch loading | `pirate-web/` |
| Swarm snapshot publisher worker | `pirate-api/` (runs as background job via `community_jobs`) |
| Shared docs | parent `docs/` |

---

## Schema

### Community DB

All tables live inside the per-community SQLite DB, same as posts.

#### `comments`

```
comment_id                  TEXT PRIMARY KEY
community_id                TEXT NOT NULL
thread_root_post_id         TEXT NOT NULL
parent_comment_id           TEXT
author_user_id              TEXT
identity_mode               TEXT NOT NULL CHECK (identity_mode IN ('public', 'anonymous'))
anonymous_scope             TEXT CHECK (anonymous_scope IS NULL OR anonymous_scope IN ('community_stable', 'thread_stable'))
anonymous_label             TEXT
body                        TEXT NOT NULL
status                      TEXT NOT NULL CHECK (status IN ('published', 'hidden', 'removed', 'deleted'))
depth                       INTEGER NOT NULL
direct_reply_count          INTEGER NOT NULL DEFAULT 0
descendant_count            INTEGER NOT NULL DEFAULT 0
upvote_count                INTEGER NOT NULL DEFAULT 0
downvote_count              INTEGER NOT NULL DEFAULT 0
score                       INTEGER NOT NULL DEFAULT 0
last_reply_at               TEXT
content_hash                TEXT
swarm_body_ref              TEXT
created_at                  TEXT NOT NULL
updated_at                  TEXT NOT NULL

FOREIGN KEY (community_id) REFERENCES communities(community_id)
FOREIGN KEY (thread_root_post_id) REFERENCES posts(post_id)
FOREIGN KEY (parent_comment_id) REFERENCES comments(comment_id)
```

Notes:

- `community_id` is redundant inside a per-community DB but kept for Swarm export consistency with the posts pattern.
- `anonymous_scope` drops `post_ephemeral` for comments. Minimum scope is `thread_stable` (a new identity per comment does not make sense).
- `swarm_snapshot_seq` is intentionally absent. Snapshot coverage is tracked on `thread_snapshots` only.
- Deletion is a tombstone: `status` becomes `'deleted'`, `body` is cleared, closure rows and tree shape are preserved.

Indexes:

```
idx_comments_thread_parent_created
    ON comments(thread_root_post_id, parent_comment_id, created_at)

idx_comments_thread_status_created
    ON comments(thread_root_post_id, status, created_at)

idx_comments_parent_created
    ON comments(parent_comment_id, created_at)

idx_comments_author_created
    ON comments(author_user_id, created_at DESC)
```

#### `comment_closure`

```
ancestor_comment_id         TEXT NOT NULL
descendant_comment_id       TEXT NOT NULL
distance                    INTEGER NOT NULL

PRIMARY KEY (ancestor_comment_id, descendant_comment_id)

FOREIGN KEY (ancestor_comment_id) REFERENCES comments(comment_id)
FOREIGN KEY (descendant_comment_id) REFERENCES comments(comment_id)
```

Indexes:

```
idx_comment_closure_ancestor_distance
    ON comment_closure(ancestor_comment_id, distance, descendant_comment_id)

idx_comment_closure_descendant
    ON comment_closure(descendant_comment_id, ancestor_comment_id)
```

Closure rows are never deleted on soft-delete. Tombstone comments keep their closure entries to preserve tree shape.

#### `comment_votes`

```
comment_vote_id             TEXT PRIMARY KEY
comment_id                  TEXT NOT NULL
user_id                     TEXT NOT NULL
vote_value                  INTEGER NOT NULL CHECK (vote_value IN (-1, 1))
created_at                  TEXT NOT NULL
updated_at                  TEXT NOT NULL

FOREIGN KEY (comment_id) REFERENCES comments(comment_id)

UNIQUE (comment_id, user_id)
```

#### Post thread counters (ALTER TABLE on `posts`)

```sql
ALTER TABLE posts ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN top_level_comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN last_comment_at TEXT;
```

This is a contracts boundary change. `Post` in `api-contracts` must be extended, and `pirate-web` must consume the new fields.

#### `thread_snapshots`

```
thread_snapshot_id              TEXT PRIMARY KEY
community_id                    TEXT NOT NULL
thread_root_post_id             TEXT NOT NULL
snapshot_seq                    INTEGER NOT NULL
published_through_comment_created_at  TEXT NOT NULL
comment_count                   INTEGER NOT NULL
swarm_manifest_ref              TEXT NOT NULL
swarm_feed_ref                  TEXT
created_at                      TEXT NOT NULL

FOREIGN KEY (community_id) REFERENCES communities(community_id)
FOREIGN KEY (thread_root_post_id) REFERENCES posts(post_id)
```

### Control-Plane DB

#### `comment_projections`

```
projection_id               TEXT PRIMARY KEY
community_id                TEXT NOT NULL
thread_root_post_id         TEXT NOT NULL
source_comment_id           TEXT NOT NULL
parent_comment_id           TEXT
depth                       INTEGER NOT NULL
status                      TEXT NOT NULL CHECK (status IN ('published', 'hidden', 'removed', 'deleted'))
source_created_at           TEXT NOT NULL
created_at                  TEXT NOT NULL
updated_at                  TEXT NOT NULL

FOREIGN KEY (community_id) REFERENCES communities(community_id)

UNIQUE (community_id, source_comment_id)
```

Indexes:

```
idx_comment_projections_thread_created
    ON comment_projections(thread_root_post_id, source_created_at DESC)

idx_comment_projections_comment_id
    ON comment_projections(source_comment_id)
```

This table is required before any global comment route can work. The resolution pattern mirrors `community_post_projections`: look up `source_comment_id` to find `community_id`, then open the per-community DB.

### Moderation Schema Extension

Add nullable `comment_id` to the existing moderation tables.

Important:

- SQLite does not support `ALTER TABLE ... ADD FOREIGN KEY` after table creation.
- `1027_comment_moderation_targets.sql` must use the standard SQLite table-rebuild pattern:
  - create replacement table with full desired schema
  - copy existing data
  - drop old table
  - rename replacement table
  - recreate indexes

Logical target schema change after the table rebuild.

Do not execute the SQL below directly in SQLite. It describes the intended end state only. The actual migration must use create/copy/drop/rename table rebuild steps.

```sql
-- moderation_cases
ALTER TABLE moderation_cases ADD COLUMN comment_id TEXT;
ALTER TABLE moderation_cases ADD FOREIGN KEY (comment_id) REFERENCES comments(comment_id);

-- Drop old open-case uniqueness, replace with scoped uniqueness
DROP INDEX IF EXISTS idx_moderation_cases_open;
CREATE UNIQUE INDEX idx_moderation_cases_open
    ON moderation_cases(community_id, COALESCE(post_id, ''), COALESCE(comment_id, ''))
    WHERE status = 'open';

-- moderation_signals
ALTER TABLE moderation_signals ADD COLUMN comment_id TEXT;
ALTER TABLE moderation_signals ADD FOREIGN KEY (comment_id) REFERENCES comments(comment_id);

-- user_reports
ALTER TABLE user_reports ADD COLUMN comment_id TEXT;
ALTER TABLE user_reports ADD FOREIGN KEY (comment_id) REFERENCES comments(comment_id);

DROP INDEX IF EXISTS idx_user_reports_unique_reporter;
CREATE UNIQUE INDEX idx_user_reports_unique_reporter
    ON user_reports(community_id, COALESCE(post_id, ''), COALESCE(comment_id, ''), reporter_user_id);

-- moderation_actions
ALTER TABLE moderation_actions ADD COLUMN comment_id TEXT;
ALTER TABLE moderation_actions ADD FOREIGN KEY (comment_id) REFERENCES comments(comment_id);
```

Exclusivity constraint: application layer must enforce that exactly one of `post_id` or `comment_id` is non-null per row. SQLite CHECK constraints across nullable columns are awkward; enforce in the service layer and validate during migration copy.

Branch moderation: moderator removal of a comment hides the body but preserves tree shape by default. If a moderator explicitly cascades removal to a subtree, the service updates `status` on all descendants found via `comment_closure` in one transaction.

---

## Migration Set

Community DB:

| File | Contents |
|---|---|
| `1024_comments_core.sql` | `comments`, `comment_votes`, indexes |
| `1025_comment_closure.sql` | `comment_closure`, indexes |
| `1026_post_thread_counters.sql` | ALTER `posts` with `comment_count`, `top_level_comment_count`, `last_comment_at` |
| `1027_comment_moderation_targets.sql` | Add nullable `comment_id` to `moderation_cases`, `moderation_signals`, `user_reports`, `moderation_actions`; update indexes |
| `1028_thread_snapshots.sql` | `thread_snapshots` |

Control-plane:

| File | Contents |
|---|---|
| `0037_control_plane_comment_projections.sql` | `comment_projections`, indexes |

Migration numbers confirmed available: community-template tops out at `1023`, control-plane at `0036`.

---

## Route Contract

### Community-scoped (resolve community from URL path)

```
POST   /communities/:communityId/posts/:postId/comments
GET    /communities/:communityId/posts/:postId/comments?sort=new|top&cursor=...
```

### Global (resolve community from control-plane projection)

```
POST   /comments/:commentId/replies
GET    /comments/:commentId/replies?sort=new|top|old&cursor=...
GET    /comments/:commentId/context
POST   /comments/:commentId/vote
DELETE /comments/:commentId
POST   /comments/:commentId/report
```

Route ownership:

- Community-scoped routes register in `routes/communities-core.ts`.
- Global comment routes register in a new `routes/comments.ts`, mounted at `/comments`.
- `/comments/:commentId/replies` and `/comments/:commentId/vote` must look up `comment_projections` to resolve `community_id` before calling `openCommunityDb`, same pattern as `post-service.ts:247`.

### Response Shape

Per comment node:

```json
{
  "comment": { ... },
  "viewer_vote": -1 | 1 | null,
  "direct_reply_count": 3,
  "descendant_count": 48,
  "preview_replies": [ ... ],
  "next_replies_cursor": "cursor_token" | null
}
```

Read model rules:

- `GET /posts/:postId/comments` returns only top-level comments (parent_comment_id IS NULL).
- Each comment includes up to 2-3 `preview_replies` (direct children, sorted by score or time).
- `preview_replies` includes a `next_replies_cursor` when more children exist.
- `GET /comments/:commentId/context` returns ancestor chain + target comment + first page of direct replies. Used for permalinks.
- No endpoint returns the full tree by default.

---

## Transaction Rules

### Write Path (`createComment`)

All steps run inside one write transaction:

1. Validate membership, verified human, rate limits.
2. Load root post (must be `published`).
3. If replying, load parent comment (must be `published` or `hidden`; not `removed` or `deleted`).
4. Compute `depth` as `parent.depth + 1`, or `0` for top-level.
5. INSERT `comments` row.
6. INSERT `comment_closure` self-row: `(comment_id, comment_id, 0)`.
7. INSERT `comment_closure` ancestor rows:
   ```sql
   INSERT INTO comment_closure (ancestor_comment_id, descendant_comment_id, distance)
   SELECT ancestor_comment_id, :new_comment_id, distance + 1
   FROM comment_closure
   WHERE descendant_comment_id = :parent_comment_id
   ```
8. UPDATE parent `direct_reply_count += 1`.
9. UPDATE all ancestors `descendant_count += 1`, `last_reply_at = :now`.
10. UPDATE `posts` set `comment_count += 1`, `top_level_comment_count += 1` (if top-level), `last_comment_at = :now`.
11. INSERT `community_jobs` row for Swarm body mirror (job_type: `comment_body_mirror`).
12. Optionally INSERT `community_jobs` row for `thread_snapshot_publish` if snapshot threshold is met.
13. COMMIT.
14. After commit (async, non-blocking):
    - INSERT `comment_projections` row in control-plane DB.
    - If the control-plane write fails, INSERT `community_jobs` row for projection retry (job_type: `comment_projection_sync`) in a new short community-DB transaction.

### Delete Path

- Set `status = 'deleted'`, clear `body` to empty string or `'[deleted]'`.
- Do NOT remove closure rows. Do NOT decrement counters.
- Preserve `author_user_id` if the viewer is a moderator; null it for non-moderator viewers in serialization.

### Moderator Remove Path

- Set `status = 'removed'`, preserve `body` for moderator review context.
- By default, descendants are not affected.
- If cascade is requested, UPDATE all descendants via `comment_closure` to `status = 'removed'` in the same transaction.

### Vote Path

```sql
INSERT INTO comment_votes (comment_vote_id, comment_id, user_id, vote_value, created_at, updated_at)
VALUES (:id, :comment_id, :user_id, :value, :now, :now)
ON CONFLICT(comment_id, user_id) DO UPDATE SET
    vote_value = excluded.vote_value,
    updated_at = excluded.updated_at
```

After commit, async: UPDATE `comments` SET `upvote_count`, `downvote_count`, `score` from aggregates.

Counter update can be inline in the same transaction for correctness, or async for performance. The tradeoff depends on write volume. Default to inline for v0.

---

## Swarm Job Model

Swarm publication is always async via `community_jobs`. Never block comment submission on Bee.

### Job Types

| Job type | Trigger | Action |
|---|---|---|
| `comment_body_mirror` | After comment commit | Upload immutable JSON blob to Swarm, update `comments.swarm_body_ref` |
| `thread_snapshot_publish` | After N new comments or T elapsed | Build thread manifest, upload to Swarm, update feed pointer, insert `thread_snapshots` row |
| `comment_projection_sync` | Control-plane projection write fails after comment commit | Retry INSERT/UPSERT of `comment_projections` row in control-plane DB |

Durability rule:

- `community_jobs` rows are inserted inside the same community-DB transaction as the canonical comment write.
- Swarm publication itself happens after commit in worker code.
- Control-plane projection writes remain out-of-transaction with the community DB and must be retryable.
- Projection retry source of truth is the community DB, not the control-plane DB. If the initial projection write fails after commit, enqueue `comment_projection_sync` from the community DB and retry until success.

### Env Fields

Add to `Env` in `types.ts`:

```
SWARM_BEE_API_URL?: string
SWARM_POSTAGE_BATCH_ID?: string
SWARM_FEED_PRIVATE_KEY?: string
SWARM_FEED_TOPIC_NAMESPACE?: string
COMMUNITY_JOB_WORKER_INTERVAL_MS?: string
COMMUNITY_JOB_WORKER_MAX_JOBS_PER_COMMUNITY?: string
COMMUNITY_JOB_WORKER_MAX_COMMUNITIES_PER_TICK?: string
```

Notes:

- `SWARM_FEED_PRIVATE_KEY` signs feed updates only. It does not pay for uploads.
- Upload cost is paid by the Bee node configured at `SWARM_BEE_API_URL`, using the prepaid postage batch in `SWARM_POSTAGE_BATCH_ID`.
- `SWARM_FEED_OWNER` is intentionally absent. The feed owner is derived from `SWARM_FEED_PRIVATE_KEY`.

### Snapshot Cadence

Current implementation: publish at most once per thread per 60 seconds. `thread_snapshot_publish` returns the latest snapshot ref immediately when the most recent snapshot is newer than the minimum interval.

Why:

- `comment_body_mirror` still runs per comment, so newly created public comments are mirrored promptly.
- `thread_snapshot_publish` is the heavier path because it reads the thread, rebuilds the snapshot collection, and updates the feed pointer.
- A minimum interval avoids rebuilding snapshots on every comment burst while preserving near-real-time degraded reads.

Planned future improvement:

- Replace the fixed 60-second worker-side throttle with a richer policy based on both:
  - time since last snapshot
  - comment-count delta since last snapshot
- The earlier RFC target of "50 comments or 5 minutes" remains a reasonable later policy, but it is not the current code path.

### Snapshot Contents

- Thread root post metadata
- Top-level comment pages (paginated)
- Branch edges (parent -> child relationships)
- Comment bodies (public comments only, excluded gated/private)
- Counts, timestamps
- Public moderation state only

### Client Fallback

- Primary: API serves live comments.
- Degraded: client fetches latest thread snapshot via Swarm feed.
- Degraded mode is read-only, potentially stale, but censorship-resistant.

---

## Deployment Model

### Phase 1: API Only v0

- Browser writes to Pirate API only.
- Pirate API writes canonical comments to the per-community DB.
- Reads come from Pirate API only.
- No Swarm dependency exists in the live request path.
- This phase ships comment schema, deep-thread reads, minimal moderation, and control-plane projections.

### Phase 2: API + Async Swarm Mirror

- After canonical comment commit, the same transaction enqueues `community_jobs`.
- A trusted backend worker publishes public comment bodies and thread snapshots to Swarm.
- Swarm is still not used in normal reads unless Pirate is degraded.

### Phase 3: API + Multi-Gateway Fallback

Read order:

1. Pirate API
2. Alternate Pirate API domains or edges
3. Swarm snapshot through gateway A
4. Swarm snapshot through gateway B
5. Swarm snapshot through gateway C

Requirements:

- Client must not depend on a single Swarm gateway.
- Degraded mode must render public read-only snapshots and show that live updates are unavailable.

### Phase 4: Native Swarm-Capable Degraded Mode

- If the client environment supports native Swarm/Bee reads, fetch snapshots directly from Swarm.
- HTTP gateways remain a fallback, not the only degraded read path.
- Writes remain API-mediated even in this phase.

### Recommended Launch Sequence

1. Ship Phase 1 first.
2. Add Phase 2 after comment behavior is stable.
3. Add Phase 3 when public-read resilience becomes a priority.
4. Treat Phase 4 as optional hardening, not a launch dependency.

### Service Boundary

- `pirate-api` remains the canonical writer and reader for live comments.
- `community_jobs` in the community DB is the async work queue.
- A trusted backend worker owns Bee API access and Swarm publish execution.
- If secrets isolation is needed later, Swarm feed signing and publish execution can move into Chipotle.
- Browser clients never hold the Swarm feed signing key.

### Secrets and Bee Access

- Bee API URL and postage configuration are backend-only concerns.
- Feed-signing private key is backend-only.
- Browser clients use normal Pirate API writes and never publish directly to Swarm.

### Environment Strategy

Recommended Swarm setup by environment:

1. `dev`
   - Default: Bee `dev` mode
   - No real chain funds required
   - Good for local API/worker integration and contract testing
2. `staging`
   - Default: Bee on Sepolia
   - Fund with Sepolia ETH + `sBZZ`
   - Use this when you want realistic Swarm behavior without production spend
3. `prod`
   - Bee on Gnosis
   - Fund with `xDAI` + `xBZZ`
   - Backed by a real postage batch

Notes:

- Bee `dev` mode is sufficient for local development if you only need upload semantics and do not need real network economics.
- Sepolia is the preferred staging target when you want to exercise real Bee funding, stamp purchase, and feed updates.
- Production Swarm writes require a funded Bee node plus a valid postage batch.

Operational reminder:

- Monitor postage batch depletion. If the batch runs dry, `comment_body_mirror` and `thread_snapshot_publish` will fail and back off, but canonical Pirate writes will still succeed.

---

## Deletion Semantics

| Action | body | status | author_user_id | closure rows | descendant counters | descendants |
|---|---|---|---|---|---|---|
| User delete | cleared / `'[deleted]'` | `'deleted'` | preserved in DB, hidden from non-mods in serialization | kept | unchanged | unaffected |
| Moderator hide | preserved | `'hidden'` | preserved | kept | unchanged | unaffected |
| Moderator remove | preserved for mod review | `'removed'` | preserved | kept | unchanged | unaffected (default) |
| Moderator remove + cascade | preserved for mod review | `'removed'` | preserved | kept | unchanged | all descendants set to `'removed'` in same tx |

---

## Moderation Semantics

- Comments are reportable: `POST /comments/:commentId/report` creates a `user_reports` row with `comment_id` set, `post_id` null.
- Moderation signals from content analysis can target comments.
- Moderator actions on a comment create `moderation_actions` rows with `comment_id` set.
- Branch removal is opt-in cascade, not the default. Moderator must explicitly choose subtree removal.
- Removed comments retain `body` for moderator review context but are not visible to non-moderators.

---

## `parent_post_id` on `posts`

After comments ship, `parent_post_id` on the `posts` table no longer means "reply." It should be documented as reserved for cross-post or quote-post semantics only. Do not add new reply-like usage of this column. Comments are the reply mechanism.

If no current code uses `parent_post_id` for replies, consider adding a comment in the schema and documentation. Do not remove the column; it may already have data.

---

## Sort Strategy

v0 sorting options: `new`, `top`.

- `new`: ORDER BY `created_at DESC`.
- `top`: ORDER BY `score DESC`.

"Best" sort (Wilson score interval, hot ranking, etc.) is deferred. Compute at query time from `score` for v0. If scale demands it, add a `confidence` or `hot_score` column later.

---

## Audit Checklist

### Schema

- [ ] Comments separated from posts in their own table
- [ ] No feed query mixes posts and comments in a single SELECT
- [ ] All FK paths explicit: `thread_root_post_id -> posts`, `parent_comment_id -> comments`
- [ ] All heavy read paths indexed (thread+parent, thread+status, parent-only, author)
- [ ] Counters are derivable from base data if corrupted (repair job possible)

### Integrity

- [ ] Closure table self-row always exists for every comment
- [ ] `depth` matches max ancestor distance in closure table (periodic repair check)
- [ ] Ancestor counters updated transactionally with comment insert
- [ ] Deleted/removed comments preserve tree shape (no closure row removal)

### Read Path

- [ ] Top-level pagination uses stable cursor (created_at + comment_id)
- [ ] Reply pagination uses stable cursor
- [ ] Context query bounded (ancestor chain + target + limited children)
- [ ] No endpoint returns full tree by default

### Moderation

- [ ] `comment_id` nullable on `moderation_cases`, `moderation_signals`, `user_reports`, `moderation_actions`
- [ ] Exactly one of `post_id` or `comment_id` set per row (enforced in service layer)
- [ ] Branch removal behavior defined (default: single node; cascade: opt-in)
- [ ] Deleted body vs tombstone behavior defined
- [ ] Votes on removed/deleted comments: allowed, no special handling
- [ ] Snapshot publishing excludes non-public content

### Control Plane

- [ ] `comment_projections` table exists and is populated before any global comment route ships
- [ ] Projection resolution follows same pattern as post projections
- [ ] Projection failure is retryable

### Swarm

- [ ] All Swarm work async via `community_jobs`, never inline with comment writes
- [ ] `community_jobs` enqueue happens inside the same transaction as canonical comment writes
- [ ] Snapshot cadence defined and configurable
- [ ] Stale snapshot behavior explicit (client shows "last mirrored" timestamp)
- [ ] Public-only mirror boundary enforced (no gated/private comment bodies in snapshots)
- [ ] Feed pointer rotation and recovery documented
- [ ] `swarm_body_ref` updated after successful upload, not before
- [ ] Failed Swarm jobs use bounded retry with backoff and stop after max attempts
- [ ] Bee funding model is documented: feed signing key is distinct from Bee node postage funding

### Failure Modes

- [ ] Bee unavailable does not block comment creation or voting
- [ ] Projection write failure is retryable (separate from community DB tx)
- [ ] Counter drift repair job exists or is planned
- [ ] Snapshot rebuild can run from canonical DB at any time
- [ ] Control-plane DB unavailable returns error for global routes but does not affect community-scoped reads

---

## Current Backend State

The backend currently matches steps 1 through 9 below.

- `comment_projections` exist and are used by global comment routes
- Community comment schema is migrated and exercised in tests
- Comment write/read/vote/delete flows are transactional
- Moderation/report routes work for both posts and comments
- Cursor pagination is implemented for comment reads
- `community_jobs` has a real worker loop and local entrypoint
- Swarm uploads are real, backend-mediated, and use `bee-js`
- Feed updates are signed by `SWARM_FEED_PRIVATE_KEY`
- Read APIs expose `thread_snapshot` refs for degraded-mode clients

Not yet complete:

- `pirate-web` fallback that actually consumes `thread_snapshot`
- selective mirroring policy (currently public/open + published content is mirrored)
- rate limiting policy for comments
- richer ranking than `score DESC`
- comment preview slices on top-level read nodes
- edit/restore flows for comments

---

## Outstanding Work

### Backend

1. Decide whether failed community jobs should gain jitter and/or an explicit dead-letter surface.
2. Decide whether to cache Bee clients per `SWARM_BEE_API_URL` instead of constructing per publish.
3. Decide whether Swarm signing should remain in `pirate-api` or move to an isolated signer/publisher service later.
4. Add moderation signal ingestion if automated comment analysis becomes part of v0.1.
5. Add comment edit/restore flows if product requires them.

### Client

1. Consume `thread_snapshot` from `GET /posts/:postId`.
2. Fall back to `thread_snapshot.swarm_feed_ref` and/or `swarm_manifest_ref` when Pirate API is unavailable.
3. Surface degraded/read-only state in UI.
4. Support multi-gateway fallback before treating native Bee reads as required.

### Policy

1. Confirm whether votes on deleted comments should remain blocked.
2. Confirm whether anonymous-scope validation should remain exact-match or allow narrower scopes.
3. Decide whether public Swarm mirroring stays “mirror all public content” for launch or becomes selective later.
4. Decide if staging should use Bee `dev` mode only or a real Sepolia Bee deployment.

### Contracts

- [ ] `Post` type extended with `comment_count`, `top_level_comment_count`, `last_comment_at`
- [ ] `Comment`, `CommentThreadSlice`, `CommentContext` types added to `api-contracts`
- [ ] `pirate-web` updated to consume new types

---

## Implementation Order

1. **Control-plane projection**: `0037_control_plane_comment_projections.sql` + repository code.
2. **Community DB schema**: migrations `1024` through `1028`.
3. **Moderation schema extension**: `1027` + service-layer enforcement.
4. **Write path**: `createComment`, `deleteComment`, `removeComment`, `castCommentVote` — all transactional.
5. **Read path**: `listTopLevelComments`, `listReplies`, `getCommentContext` — lazy, paginated.
6. **Routes**: community-scoped first, then global (projection-resolved).
7. **Contracts**: extend `Post`, add `Comment` types, update `pirate-web`.
8. **Swarm jobs**: `comment_body_mirror`, `thread_snapshot_publish` via `community_jobs`.
9. **Projection retry job**: `comment_projection_sync` via `community_jobs`.
10. **Client fallback**: Swarm feed read in `pirate-web` for degraded mode.

Steps 1-3 are prerequisites for all route work. Do not start step 4 until 1-3 are committed.
