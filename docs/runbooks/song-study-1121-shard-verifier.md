# Song Study 1121 Shard Verifier

Use this when rolling out `1121_song_study_attempt_identity.sql` to community
shards. This migration rebuilds `song_study_attempt`, removes
`review_session_id`, and changes durable attempt identity to
`UNIQUE(user_id, idempotency_key)` only.

This is the irreversible gate for due-review and streak GA. Do not enable
`SONG_STUDY_DUE_REVIEW_SERVING_ENABLED` or
`SONG_STUDY_STREAK_WRITES_ENABLED` until every target shard passes.

## Precondition

Before the first canary, confirm both facts:

- The D1 community-migration runner applies each migration file in a single
  transaction, so a crash during the rebuild rolls back instead of stranding a
  shard between `CREATE`, `INSERT`, `DROP`, and `RENAME`.
- The shard restore procedure is known and available: backup source, restore
  command, and the operator who can run it.

A flag rollback does not undo this migration.

## Flow

For each canary shard:

1. Capture the BEFORE row count and fingerprint.
2. Apply community-template migrations through 1121.
3. Run every AFTER assertion below.
4. Halt on any failure, restore the canary shard, and root-cause before touching
   the fleet.

Fleet gate: 100% of target shards pass the same AFTER assertions.

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
