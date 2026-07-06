# Song Study 1121 Shard Verifier

Use this when rolling out `1121_song_study_attempt_identity.sql` to community
shards. This migration rebuilds `song_study_attempt`, removes
`review_session_id`, and changes durable attempt identity to
`UNIQUE(user_id, idempotency_key)` only.

This is the irreversible gate for due-review and streak GA. Do not enable
`SONG_STUDY_DUE_REVIEW_SERVING_ENABLED` or
`SONG_STUDY_STREAK_WRITES_ENABLED` until every target shard passes.

`1121_song_study_attempt_identity.sql` is a table rebuild:

1. `CREATE TABLE song_study_attempt_next (...)`
2. copy rows from `song_study_attempt`
3. `DROP TABLE song_study_attempt`
4. rename `_next` back to `song_study_attempt`
5. recreate the review lookup index

That is why this runbook treats row-count/fingerprint preservation and restore
readiness as launch gates. The currently deployed API is already compatible with
both the pre-1121 and post-1121 table shapes: it no longer writes
`review_session_id`, and the old table already has `UNIQUE(user_id,
idempotency_key)`. Applying 1121 to a live shard is therefore an online schema
hardening step, but it can briefly serialize concurrent study attempt writes
while the table is rebuilt. Run canaries and fleet rollout in a low-traffic
window.

## Precondition

Before the first canary, confirm both facts:

- The D1 community-migration runner applies each migration file in a single
  transaction, so a crash during the rebuild rolls back instead of stranding a
  shard between `CREATE`, `INSERT`, `DROP`, and `RENAME`.
- The runner executes community-template migrations directly against D1
  (`wrangler d1 execute` or D1 HTTP API), not through the community shard RPC
  worker. The shard RPC write path intentionally rejects DDL.
- The shard restore procedure is known and available: D1 Time Travel restore is
  enabled for the shard, the point-in-time restore command is known, and the
  operator who can run it is online.

A flag rollback does not undo this migration. D1 Time Travel restore is
point-in-time and whole-database; it discards writes made after the selected
restore point. Record that possible data-loss window before touching a canary.

## Flow

For each canary shard:

1. Capture the BEFORE row count and fingerprint.
2. Apply the contiguous community-template migration sequence through 1121:
   `1118_song_study_review_sessions.sql`,
   `1119_song_streaks.sql`, `1120_restore_rights_review_cases.sql`, and
   `1121_song_study_attempt_identity.sql`.
3. Run every AFTER assertion below.
4. Halt on any failure, restore the canary shard, and root-cause before touching
   the fleet.

Fleet gate: 100% of target shards pass the same AFTER assertions.

Choose canaries deliberately. A useful canary is a low-traffic community shard
that already has real `song_study_attempt` rows. An empty attempt table can prove
the final schema shape, but it does not exercise 1121's data-preservation risk.

The fleet apply tool must be idempotent and resumable: skip migrations already
recorded with the expected checksum, halt on checksum drift, record per-shard
status, and back off/retry transient D1 rate-limit or network failures. A
mid-fleet failure should resume from the passed shard list, not restart the whole
140-shard operation.

Remote D1 SQL files must not include explicit `BEGIN`, `COMMIT`, or `SAVEPOINT`
statements; D1 rejects them. Keep the migration body and the
`schema_migrations` ledger insert in the same uploaded SQL file and rely on
Wrangler/D1's all-or-original file execution. A canary run on
`community-d1-pool-0073-prod` verified this behavior on 2026-07-06.

## 0. BEFORE Capture

Run before applying 1121 on each canary shard.

```sql
SELECT COUNT(*) AS attempt_rows FROM song_study_attempt;
```

```sql
SELECT COUNT(*) AS n,
       COALESCE(GROUP_CONCAT(fp), '') AS fingerprint
FROM (
  SELECT id || '|' || idempotency_key || '|' || outcome || '|' ||
         COALESCE(fsrs_rating,'') || '|' || attempt_number AS fp
  FROM song_study_attempt
  ORDER BY id
);
```

Save both outputs. The AFTER values must match exactly.

For remote D1 fleet tooling, prefer a paged client-side SHA-256 fingerprint over
returning the raw `GROUP_CONCAT` result. The exact row material should be the
same ordered fields shown above (`id`, `idempotency_key`, `outcome`,
`fsrs_rating`, `attempt_number`), but hashing client-side avoids D1 result-size
limits on large shards while preserving an exact before/after equality check.

## 1. AFTER Schema Shape

This query is authoritative for the final table shape. It checks the final
idempotency constraint and both superseded identity shapes.

```sql
SELECT
  (
    sql LIKE '%UNIQUE (user_id, idempotency_key)%'
    OR sql LIKE '%UNIQUE(user_id, idempotency_key)%'
  ) AS a2b_has_idem_unique,
  (sql LIKE '%review_session_id%') AS a1_has_rsid,
  (sql LIKE '%(user_id, exercise_id, attempt_number)%') AS a2a_has_1109_unique,
  (sql LIKE '%review_session_id, attempt_number%') AS has_1118_unique
FROM sqlite_master
WHERE type = 'table' AND name = 'song_study_attempt';
```

Pass iff the result is:

```text
a2b_has_idem_unique = 1
a1_has_rsid = 0
a2a_has_1109_unique = 0
has_1118_unique = 0
```

Structural cross-check:

```sql
SELECT name, GROUP_CONCAT(col) AS cols
FROM (
  SELECT il.name, ii.seqno, ii.name AS col
  FROM pragma_index_list('song_study_attempt') il
  JOIN pragma_index_info(il.name) ii
  WHERE il.origin = 'u'
  ORDER BY il.name, ii.seqno
)
GROUP BY name;
```

Pass iff there is exactly one unique constraint and its `cols` value is:

```text
user_id,idempotency_key
```

## 2. AFTER Column And Index Presence

`review_session_id` must be gone:

```sql
SELECT COUNT(*) AS rsid_cols
FROM pragma_table_info('song_study_attempt')
WHERE name = 'review_session_id';
```

Pass iff `rsid_cols = 0`.

The review lookup index must exist. The table rebuild drops indexes, so 1121
must recreate it.

```sql
SELECT COUNT(*) AS review_index
FROM sqlite_master
WHERE type = 'index' AND name = 'idx_song_study_attempt_review_unit';
```

Pass iff `review_index = 1`.

## 3. AFTER Data Preservation

Run the same row-count and fingerprint queries from the BEFORE capture:

```sql
SELECT COUNT(*) AS attempt_rows FROM song_study_attempt;
```

```sql
SELECT COUNT(*) AS n,
       COALESCE(GROUP_CONCAT(fp), '') AS fingerprint
FROM (
  SELECT id || '|' || idempotency_key || '|' || outcome || '|' ||
         COALESCE(fsrs_rating,'') || '|' || attempt_number AS fp
  FROM song_study_attempt
  ORDER BY id
);
```

Pass iff:

- AFTER `attempt_rows` equals BEFORE `attempt_rows`.
- AFTER `n` equals BEFORE `n`.
- AFTER `fingerprint` equals BEFORE `fingerprint`.

This catches rebuilds that silently drop rows or mutate preserved fields.

## 4. Coverage And Dark-Inertness

Run this before merge on a prod shard sample, and again per shard during
migration verification:

```sql
SELECT COUNT(*) AS orphaned_attempts
FROM song_study_attempt a
WHERE NOT EXISTS (
  SELECT 1
  FROM song_study_review_state s
  WHERE s.user_id = a.user_id
    AND s.post_id = a.post_id
    AND s.line_id = a.line_id
    AND s.exercise_type = a.exercise_type
    AND s.target_language = a.target_language
);
```

Expected: `orphaned_attempts = 0`.

Nonzero is not a migration failure. It is the exact blast radius where the dark
read path is not perfectly inert: those already-attempted units can re-serve
once because the final dark predicate is `review_state IS NULL`.

Record the count in the rollout notes.

## 5. Version Ledger

If the community-migration runner exposes an applied-migrations ledger, confirm
the shard records `1121_song_study_attempt_identity` as applied.

The schema checks above are authoritative. Do not rely on the ledger alone; the
risk is a partial rebuild that a ledger could misrepresent.

## Pass / Fail

Shard pass:

- Section 1 result is `1, 0, 0, 0`.
- Section 1 structural cross-check has exactly `user_id,idempotency_key`.
- Section 2 has `rsid_cols = 0` and `review_index = 1`.
- Section 3 count and fingerprint match the BEFORE capture.
- Section 4 orphan count is recorded.
- Section 5 ledger is checked when available.

Any canary failure:

1. Halt rollout.
2. Do not touch fleet shards.
3. Restore the failed shard from backup.
4. Root-cause before retrying.

Fleet gate:

- Every target shard passes.
- Fleet-wide roll-up shows zero shards with a `review_session_id` column.

No due-review or streak flag may be enabled before the fleet gate passes. An
unmigrated shard still carries an old attempt uniqueness constraint and cannot
accept a valid due-review re-submit of `attempt_number = 1` under a new
idempotency key.
