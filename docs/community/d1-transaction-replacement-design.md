# Phase 0.2: Transaction Audit and D1 Replacement Designs

Status: draft

This document audits the five highest-risk interactive transaction sites and specifies the D1 batch and conditional-SQL replacements. Each site has its own atomicity, idempotency, retry, and error mapping plan. The design is the basis for the phase 0.2 implementation that must complete before phase 2 begins.

## D1 Model vs. libSQL Model

D1 provides `db.batch(statements)`, which is atomic for the entire batch on a single D1 database. D1 does not provide an interactive `tx.execute(...)` model with read-your-own-writes semantics across multiple awaits. Statements submitted in a single `batch` either all apply or none apply.

This is the replacement primitive for the five sites. Where the current code uses `tx.execute({...})` followed by another `tx.execute({...})` separated by a `await someCheck()` or `await someRead()`, the new code must:

- Move conditional logic into SQL (e.g. `INSERT ... ON CONFLICT`, `UPDATE ... WHERE ... RETURNING`, `INSERT ... SELECT ... WHERE NOT EXISTS`).
- Or move the conditional logic outside the batch (read first, then batch the write).
- Or split the work into two batches with explicit compensation between them.

The design constraint: a batch must be deterministic given its inputs. Any read inside a batch is unsafe because D1 does not guarantee read-your-writes inside a batch when other clients are writing.

## Shared Patterns

These patterns are reused across the five sites. Each is referenced from the site-specific design.

### A. Idempotency via deterministic primary keys

The codebase already mints IDs with stable prefixes (`post_`, `cmt_`, `ch_`, `case_`, `pur_`). The replacement designs preserve this. Every insert is also an `ON CONFLICT DO NOTHING` so a retry with the same primary key is a no-op rather than a failure.

### B. Conditional update via WHERE clause

The current code reads a row, checks a field, and conditionally updates. The replacement code uses `UPDATE ... SET ... WHERE ...` with the same predicate in the `WHERE` clause, then asserts `rowsAffected` matches expectations. A `rowsAffected` of 0 is a structured error, not a silent success.

### C. Read-then-batch split

When a batch needs an input that depends on a read, the read happens outside the batch and the result is bound into the batch. The read uses the primary-constrained session (`db.withSession("first-primary")`) so the batch's view of state matches what the read saw, modulo races with other writers.

### D. Compensating batches

When a batch fails after a partial side effect, a follow-up batch undoes the partial effect. Compensation is recorded in a `compensation_log` table when it is non-trivial. For the five sites, the only case that needs explicit compensation is settlement.

### E. Error mapping

D1 returns a structured error. The replacement code maps:

- `SQLITE_CONSTRAINT_PRIMARYKEY` to `idempotency_replay` (success path on retry).
- `SQLITE_CONSTRAINT_UNIQUE` to `conflict` (409 with the conflicting field).
- `SQLITE_CONSTRAINT_FOREIGNKEY` to `invalid_reference` (400 with the missing reference).
- `SQLITE_CONSTRAINT_NOTNULL` to `invalid_state` (500; this is a code bug, not user input).
- Anything else to a generic `db_error` (500).

The mapping is centralized in the `d1-adapter` error normalizer.

## Site 1: Post Creation

### Current Pattern

`post-service.ts:307-417` opens a write transaction and runs the following steps inside it:

1. `insertPost(...)` — INSERT into `posts`.
2. `enqueuePostTranslationPrewarmJobs(...)` — INSERT into `community_jobs`.
3. `enqueuePostLabelIfNeeded(...)` — conditional INSERT into `community_jobs` (skipped when not needed).
4. `enqueueEmbedHydrateIfNeeded(...)` — conditional INSERT into `community_jobs`.
5. `recordReviewRequiredPostModeration(...)` — conditional INSERT into `moderation_actions` and `moderation_cases` (only when analysis state is `review_required`).
6. `tx.commit()`.

Two steps after the commit run post-commit asset tasks (song bundle registration, video asset registration). They use the outer client, not the transaction, and they can fail without rolling back the post. The control-plane projection update is also post-commit.

### D1 Replacement

A single `db.batch([...])` with all writes that must be atomic. Post-commit asset tasks stay post-commit; they are best-effort and the job queue recovers them.

```ts
const statements: D1PreparedStatement[] = [
  db.prepare(`
    INSERT INTO posts (post_id, community_id, author_user_id, identity_mode, ...)
    VALUES (?1, ?2, ?3, ?4, ...)
    ON CONFLICT(post_id) DO NOTHING
  `).bind(postId, communityId, userId, identityMode, ...),
]

if (needsTranslationPrewarm) {
  statements.push(
    db.prepare(`
      INSERT INTO community_jobs (job_id, community_id, job_type, subject_type, subject_id, payload_json, status, available_at, created_at, updated_at)
      VALUES (?1, ?2, 'post_translate_prewarm', 'post', ?3, ?4, 'queued', ?5, ?5, ?5)
      ON CONFLICT(job_id) DO NOTHING
    `).bind(jobId, communityId, postId, payloadJson, createdAt),
  )
}

// enqueueLabelIfNeeded, enqueueEmbedHydrateIfNeeded: same shape, conditional push.

if (analysisOverride?.analysis_state === "review_required") {
  statements.push(
    db.prepare(`INSERT INTO moderation_cases (...) VALUES (...) ON CONFLICT DO NOTHING`).bind(...),
    db.prepare(`INSERT INTO moderation_actions (...) VALUES (...) ON CONFLICT DO NOTHING`).bind(...),
  )
}

const result = await db.batch(statements)
```

### Atomicity Boundary

The post row, the always-needed prewarm job, the conditional prewarm/label/embed jobs, and the optional moderation case/action are all atomic. The post-commit asset tasks are not in the batch; they are best-effort and re-enqueueable.

### Uniqueness and Concurrency

The `post_id` is the deterministic key. The unique constraint on `(community_id, idempotency_key)` (or equivalent) is the natural dedup. A retry with the same `post_id` is a no-op for the post and an `idempotency_replay` for the caller.

### Idempotency Behavior

The post is created exactly once per `post_id`. The prewarm/label/embed jobs are created exactly once per `(job_type, subject_id)` pair. The `ON CONFLICT DO NOTHING` covers replay.

### Conditional Update Strategy

Conditional job enqueues are pushed into the batch only when the condition is met in the application code. There is no need for a SQL-level predicate because the condition is known at the time the batch is built.

### Partial-Failure Behavior

If the batch fails entirely, no rows are written. The post is not visible. The next retry either succeeds or returns the same error. There is no partial state to clean up.

### Retry Safety

The batch is safe to retry because all inserts use `ON CONFLICT DO NOTHING`. The post-commit tasks use a separate idempotency check (the job queue's existing dedup by `(job_type, subject_id)`).

### Error Mapping

- `idempotency_replay` if a prior call committed.
- `invalid_state` if a NOT NULL constraint fails.
- `db_error` for any other D1 error.

### Compensation

None. The post-commit tasks are out of band.

## Site 2: Comment Creation

### Current Pattern

`comment-service.ts:342-491` opens a write transaction and runs:

1. `insertComment(...)` — INSERT into `comments`.
2. `insertCommentClosureRows(...)` — multiple INSERTs into `comment_closure` (one per ancestor).
3. `incrementAncestorCommentCounters(...)` — UPDATE on `comments.direct_reply_count` and `comments.descendant_count` for each ancestor.
4. `incrementThreadPostCommentCounters(...)` — UPDATE on `posts.cached_comment_count`.
5. `enqueueCommunityJob(...)` — INSERT into `community_jobs` (two: `comment_body_mirror` and `thread_snapshot_publish`).
6. `enqueueCommentTranslationPrewarmJobs(...)` — INSERT into `community_jobs`.
7. `tx.commit()`.

### D1 Replacement

A single `db.batch([...])` with all writes. The closure rows and the ancestor counter updates are computed in JavaScript and pushed as prepared statements. The batch size is bounded: the closure rows for a deep thread are at most `depth` rows, which is small in practice. The batch has 2 + depth + 1 + 1 + N job rows; this stays well under the 10,000 statement limit for any reasonable thread depth.

```ts
const statements: D1PreparedStatement[] = [
  db.prepare(`INSERT INTO comments (...) VALUES (...) ON CONFLICT(comment_id) DO NOTHING`).bind(...),
]

for (const ancestor of ancestors) {
  statements.push(
    db.prepare(`
      INSERT INTO comment_closure (ancestor_comment_id, descendant_comment_id, distance)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(ancestor_comment_id, descendant_comment_id) DO NOTHING
    `).bind(ancestor.commentId, createdComment.comment_id, ancestor.distance),
  )
}

for (const ancestor of ancestors) {
  statements.push(
    db.prepare(`
      UPDATE comments
      SET direct_reply_count = direct_reply_count + ?2,
          descendant_count = descendant_count + ?2,
          last_reply_at = COALESCE(last_reply_at, ?3),
          updated_at = ?3
      WHERE comment_id = ?1
    `).bind(ancestor.commentId, isTopLevel ? 0 : 1, createdAt),
  )
}

statements.push(
  db.prepare(`
    UPDATE posts
    SET cached_comment_count = cached_comment_count + 1,
        cached_last_comment_at = ?2,
        updated_at = ?2
    WHERE post_id = ?1
  `).bind(threadRootPostId, createdAt),
)

// job enqueues follow the same pattern as Site 1.
```

### Atomicity Boundary

Comment row, closure rows, ancestor counter updates, post counter update, and job enqueues are all atomic.

### Uniqueness and Concurrency

`comment_id` is the deterministic key. The closure rows have a composite primary key `(ancestor_comment_id, descendant_comment_id)`. Concurrent comment creation on the same parent is handled by the conditional UPDATE; if a race causes a counter to drift, the existing reconciliation job catches it.

### Idempotency Behavior

A retry with the same `comment_id` is a no-op for the comment and a no-op for the closure rows. The counter UPDATEs do not have `ON CONFLICT` because they are not unique-key inserts. The post counter is updated atomically with the comment. To make counter updates idempotent, the batch is gated by a check: the caller asserts the `comment_id` did not exist before the batch and only retries the entire batch on a unique-key conflict, not on any error.

### Conditional Update Strategy

The ancestor counter UPDATEs use the comment_id list computed in JavaScript. There is no SQL-level predicate.

### Partial-Failure Behavior

If the batch fails, no rows are written. No partial state.

### Retry Safety

Safe to retry only on `idempotency_replay` (a primary-key conflict on `comment_id` indicates a successful prior call). Counter updates are not idempotent on their own, so a generic retry would double-count. The retry guard lives in the route handler, not in D1.

### Error Mapping

Same as Site 1.

### Compensation

None. Reconciliation is via the existing job system, not inline.

## Site 3: Moderation Actions

### Current Pattern

`moderation-service.ts:164-208` opens a write transaction for a post report:

1. `getOpenModerationCaseForTarget(...)` — read the open case (if any).
2. Conditional: create a new case or update an existing case's `opened_by` from `platform_analysis` to `mixed`.
3. `createUserReport(...)` — INSERT into `user_reports`.
4. `tx.commit()`.

`moderation-service.ts:246-356` does the same shape for comment reports.

A separate set of moderation-action inserts runs at `moderation-service.ts:513-...` for moderator decisions (approve, reject, ban). The pattern is similar.

### D1 Replacement

The current "read case, conditionally create, insert report" pattern does not translate directly. The replacement is:

1. Read the open case outside the batch (primary-constrained session).
2. If no case exists, push a single INSERT into the batch with `ON CONFLICT DO NOTHING` against a deterministic case id.
3. The user_reports INSERT is the same shape as before.
4. The "update opened_by to mixed" case requires reading the existing `opened_by` first. Outside the batch, read it. Inside the batch, the UPDATE is conditional on the read value: `UPDATE moderation_cases SET opened_by = 'mixed', ... WHERE moderation_case_id = ?1 AND opened_by = 'platform_analysis'`. A `rowsAffected` of 0 means a concurrent report already updated it; that is not an error.

```ts
// Step 1: read the case and its opened_by (outside batch).
const existing = await readOpenModerationCaseForTarget(db, target)

// Step 2: build the batch.
const statements: D1PreparedStatement[] = []
if (!existing) {
  statements.push(
    db.prepare(`INSERT INTO moderation_cases (...) VALUES (...) ON CONFLICT(moderation_case_id) DO NOTHING`).bind(caseId, ...),
  )
} else {
  if (existing.opened_by === "platform_analysis") {
    statements.push(
      db.prepare(`UPDATE moderation_cases SET opened_by = 'mixed', updated_at = ?2 WHERE moderation_case_id = ?1 AND opened_by = 'platform_analysis'`).bind(existing.caseId, now),
    )
  }
}
statements.push(
  db.prepare(`INSERT INTO user_reports (...) VALUES (...) ON CONFLICT(user_report_id) DO NOTHING`).bind(reportId, ...),
)
await db.batch(statements)
```

### Atomicity Boundary

Case creation/update plus the user report are atomic. The case lookup is not part of the batch.

### Uniqueness and Concurrency

The deterministic `case_id` is `case_<community>_<target_kind>_<target_id>` so concurrent reports for the same target produce the same `case_id`. The `ON CONFLICT DO NOTHING` means only one of them inserts; the others treat it as a successful prior call.

The "opened_by to mixed" race is handled by the `WHERE opened_by = 'platform_analysis'` predicate. The first update wins; subsequent updates are no-ops.

### Idempotency Behavior

A retry with the same `user_report_id` is a no-op. A retry with a different `user_report_id` for the same target creates a new report against the same case; the case is not duplicated.

### Conditional Update Strategy

The opened_by update is conditional in SQL. The case creation is conditional in JavaScript (only pushed when no case exists).

### Partial-Failure Behavior

If the batch fails, no rows are written. The next retry re-reads the case and rebuilds the batch.

### Retry Safety

Safe to retry because all inserts use `ON CONFLICT DO NOTHING`. The opened_by UPDATE is idempotent on the predicate.

### Error Mapping

- `invalid_state` if a NOT NULL constraint fails (e.g. missing `priority`).
- `db_error` for any other D1 error.

### Compensation

None. The moderator-decision variants follow the same shape and add the appropriate audit log insert.

## Site 4: Community Handle Claims

### Current Pattern

`handle-claim-service.ts:859-913` opens a write transaction:

1. `getNamespacePolicy(tx, ...)` — read the policy.
2. `assertLabelLength(...)` and `isReservedLabel(...)` — application-level checks against the policy.
3. `getBlockingHandleForLabel(tx, ...)` — read any blocking handle (active or reserved).
4. `INSERT INTO community_handles (...)` with a deterministic `handle_id`.
5. `SELECT * FROM community_handles WHERE handle_id = ?` — read the row back to serialize it.
6. `tx.commit()`.

The read-back of the inserted row is a libSQL-only convenience. On D1, the inserted row is in the batch's write set, but a separate read is the only way to fetch it.

### D1 Replacement

Split into three phases: a pre-batch validation read, a session-scoped batch insert, and a session-pinned read-back.

```ts
// Phase 1: read the policy, the reserved list, and the blocking handle.
const policy = await readNamespacePolicy(db, communityId) // read outside batch
assertLabelLength(label, policy)
if (isReservedLabel(label, policy)) throw conflictError("reserved", ...)

const blocking = await readBlockingHandleForLabel(db, policy.namespace_id, label)
if (blocking) throw conflictError(blocking.status === "reserved" ? "reserved" : "taken", ...)

// Phase 2: batch insert on a primary-constrained session.
const session = db.withSession("first-primary")
let bookmark: string | null = null
try {
  await session.batch([
    db.prepare(`
      INSERT INTO community_handles (community_handle_id, community_id, user_id, namespace_id, label_normalized, label_display, status, issuance_source, price_cents, currency, pricing_model, pricing_tier, lease_started_at, lease_expires_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reserved', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
      ON CONFLICT(community_handle_id) DO NOTHING
    `).bind(handleId, communityId, userId, policy.namespace_id, label, label, issuanceSource, ...),
  ])
  bookmark = session.getBookmark()
} finally {
  session.close()
}

// Phase 3: serialize the row. Read it back on a session pinned to the bookmark so the read sees the batch's write even under replica lag.
const readSession = bookmark
  ? db.withSession(bookmark)
  : db.withSession("first-primary")
try {
  const row = await readSession
    .prepare("SELECT * FROM community_handles WHERE community_handle_id = ?1")
    .bind(handleId)
    .first()
  if (!row) throw internalError("Inserted handle row is missing after batch")
  return serializeHandle(row)
} finally {
  readSession.close()
}
```

### Atomicity Boundary

The handle insert is atomic on its own. The pre-batch reads are not in the batch.

### Uniqueness and Concurrency

The deterministic `handle_id` is `ch_<stable_hash>`. The unique indexes are on `(namespace_id, label_normalized) WHERE status = 'active'` and `(namespace_id, user_id) WHERE status = 'active'`. A race between two claims for the same label surfaces as a `SQLITE_CONSTRAINT_UNIQUE` on `(namespace_id, label_normalized)`. The caller maps that to `conflict_taken`.

The blocking-handle pre-read is not a uniqueness check; it is a UX optimization that returns a friendly error before the batch runs. The unique index is the actual guard.

### Idempotency Behavior

A retry with the same `handle_id` is a no-op (primary-key conflict, mapped to `idempotency_replay`). A retry with a different `handle_id` for the same label surfaces the unique-index conflict.

### Conditional Update Strategy

None; the insert is unconditional once validation passes.

### Partial-Failure Behavior

If the batch fails, no row is written. The next retry either re-validates and succeeds or surfaces the conflict.

### Retry Safety

Safe to retry. The pre-batch reads might return a different answer on retry (a concurrent claimer might have inserted a blocking handle between phases), and that is the correct behavior: the retry sees the new state and acts on it. The session is closed in `finally` so a failed batch never leaks.

### Error Mapping

- `SQLITE_CONSTRAINT_UNIQUE` on `(namespace_id, label_normalized)` → `conflict_taken`.
- `SQLITE_CONSTRAINT_PRIMARYKEY` on `community_handle_id` → `idempotency_replay`.
- `db_error` for any other D1 error.

### Compensation

None. The read-back is a separate read, not a write. The bookmark-pinned read ensures the read sees the batch's write even if a replica exists.

## Site 5: Purchase Settlement

### Current Pattern

`settlement-service.ts:207-380` opens a write transaction:

1. `INSERT INTO purchases ... ON CONFLICT(purchase_id) DO NOTHING` — the purchase row.
2. For each allocation leg, `INSERT INTO purchase_allocation_legs ... ON CONFLICT(purchase_allocation_leg_id) DO UPDATE SET ...` — upsert the legs.
3. `INSERT INTO purchase_entitlements ... ON CONFLICT(purchase_entitlement_id) DO UPDATE SET ...` — upsert the entitlement.
4. `UPDATE purchase_quotes SET status = 'consumed' WHERE community_id = ?1 AND quote_id = ?2 AND status = 'active'`. If `rowsAffected` is 0, the quote is not in `active` state and the call throws.
5. `UPDATE purchase_settlement_attempts SET status = 'finalized' WHERE community_id = ?1 AND quote_id = ?2`.
6. `tx.commit()`.

The reads before the transaction (`getPurchaseQuoteRow`, `getListingRowById`) are outside the transaction and feed the inputs.

### D1 Replacement

The same structure works because the current code is already close to batch-shape: each statement is unconditional, the conditional logic is in the `WHERE` clauses, and the only "look at the result" is the `rowsAffected` check on the quote update.

```ts
const statements: D1PreparedStatement[] = [
  // Purchase row.
  db.prepare(`INSERT INTO purchases (...) VALUES (...) ON CONFLICT(purchase_id) DO NOTHING`).bind(...),
  // Per-leg upsert.
  ...input.allocationSnapshot.map((allocation) =>
    db.prepare(`INSERT INTO purchase_allocation_legs (...) VALUES (...) ON CONFLICT(purchase_allocation_leg_id) DO UPDATE SET ...`).bind(...),
  ),
  // Entitlement upsert.
  db.prepare(`INSERT INTO purchase_entitlements (...) VALUES (...) ON CONFLICT(purchase_entitlement_id) DO UPDATE SET ...`).bind(...),
  // Quote consumption (conditional).
  db.prepare(`UPDATE purchase_quotes SET status = 'consumed', consumed_at = ?3, updated_at = ?3 WHERE community_id = ?1 AND quote_id = ?2 AND status = 'active'`).bind(communityId, quoteId, createdAt),
  // Settlement attempt finalization.
  db.prepare(`UPDATE purchase_settlement_attempts SET status = 'finalized', failure_reason = NULL, updated_at = ?3 WHERE community_id = ?1 AND quote_id = ?2`).bind(communityId, quoteId, createdAt),
]

const session = db.withSession("first-primary")
let result: D1Result[]
try {
  result = await session.batch(statements)
  const bookmark = session.getBookmark()

  // Re-read the quote state on the same session, pinned to the bookmark, so the post-batch check sees the batch's write.
  const quoteRow = await session
    .prepare("SELECT status, consumed_at FROM purchase_quotes WHERE community_id = ?1 AND quote_id = ?2")
    .bind(communityId, quoteId)
    .first({ bookmark })
  if (quoteRow?.status !== "consumed") {
    throw conflictError("Purchase quote could not be consumed")
  }

  // Read back the persisted purchase, entitlement, and legs.
  // Same session, same bookmark, so read-after-write is consistent.
  // ...fetch and serialize...
} finally {
  session.close()
}
```

The check uses the post-batch read of `purchase_quotes.status`, not the pre-batch `input.quote.status`. A retry that re-reads the quote after a prior committed batch sees `status = 'consumed'` and accepts the replay; a retry against an actually-not-active quote still surfaces the conflict.

### Atomicity Boundary

The purchase row, all leg upserts, the entitlement upsert, the quote consumption, and the settlement attempt finalization are all atomic.

### Uniqueness and Concurrency

The deterministic `purchase_id` is the dedup key. The `ON CONFLICT DO NOTHING` on the purchase and the `ON CONFLICT DO UPDATE` on the legs and entitlement make the batch safe under concurrent retry from a webhook that may have been delivered twice.

The `UPDATE purchase_quotes ... WHERE status = 'active'` is the actual transition from `active` to `consumed`. The post-batch re-read is the guard.

### Idempotency Behavior

A retry with the same `purchase_id` is a full replay: the purchase is a no-op, the legs and entitlement upsert are no-ops (the values match), the quote update is a no-op (it is already `consumed` after the first run, so `WHERE status = 'active'` matches 0 rows), and the post-batch re-read sees `status = 'consumed'` so the call returns success.

### Conditional Update Strategy

The quote update is conditional in SQL. The leg and entitlement upserts use `ON CONFLICT DO UPDATE` to handle the "first run vs. retry" distinction.

### Partial-Failure Behavior

If the batch fails, no rows are written. The next retry sees the same quote state and replays cleanly.

### Retry Safety

Fully safe. The `ON CONFLICT` clauses and the conditional UPDATE make the batch idempotent. The post-batch re-read uses the bookmark from the same session, so it sees the batch's write even if D1 is configured with replicas. A retry after a network failure where the batch actually committed returns success on the re-read.

### Error Mapping

- `conflict_quote_not_active` when the post-batch re-read of `purchase_quotes.status` is not `consumed` and the prior state is not `consumed`.
- `idempotency_replay` for any other constraint conflict.
- `db_error` for any other D1 error.

### Compensation

The settlement webhook may have already moved the on-chain transaction when the D1 batch is invoked. The webhook's retry contract is unchanged: the webhook re-invokes this D1 path with the same `purchase_id`. The D1 path's idempotency is the on-chain-vs-D1 double-execution guard. If the on-chain transaction fails entirely, the existing refund path runs and uses its own batch (out of scope for this audit).

The D1 path does not need to know whether the on-chain transaction already moved; the deterministic `purchase_id` and the post-batch re-read are the only authority.

## Implementation Order

The five sites are implemented in this order:

1. Post creation. It is the most common write and the simplest batch shape. It exercises the d1-adapter's `batch` and `ON CONFLICT` plumbing.
2. Comment creation. It builds on post creation's primitives and adds the closure-row loop.
3. Moderation actions. It exercises the read-then-batch split.
4. Handle claims. It exercises the deterministic-id and unique-index patterns.
5. Purchase settlement. It is the most safety-critical because the quote state transition is the durability boundary.

Each site is implemented as a separate change with its own test suite, including a test that exercises partial failure and retry.

## Open Questions

- **Batch statement count ceiling.** The D1 paid-plan limit is 10,000 statements per batch. Comment creation's worst case is `2 + depth + 1 + 1 + N`. If `N` (prewarm jobs) grows, the batch could approach the limit. The fix is to split prewarm enqueues into a follow-up batch; that breaks atomicity and is acceptable because the prewarm jobs are best-effort and re-enqueueable.
- **D1 session affinity for the read-then-batch split.** The replacement design assumes the read happens on a primary-constrained session and the batch is on the same binding. The binding-management design (separate shard Worker) must keep the read and the batch on the same D1 database. The shard's request handler holds the binding and serves both the read and the batch.
- **Backpressure on the moderation queue.** A failed batch retries from the route handler. The existing moderation case-state machinery is preserved; this design only changes the SQL wrapper around it.
- **Settlement webhook idempotency.** The D1 replacement relies on the same `purchase_id` dedup. If the on-chain `settlement_tx_ref` changes between attempts (it should not, but...), the upsert path uses the new value, which is correct.
