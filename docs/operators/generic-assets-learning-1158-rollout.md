# Generic assets and learning migration 1158 rollout

## Safety evidence

Migration `1158_generic_assets_learning_foundation.sql` rebuilds `posts`,
`assets`, `post_publish_requests`, and `moderation_actions`. The fleet runner
uploads the migration bytes and ledger insert as one unmodified
`wrangler d1 execute --file` import.

On 2026-08-13, a disposable remote staging D1 database was used to test the
failure boundary. The uploaded poison file created and populated `posts_next`,
dropped `posts`, renamed `posts_next` to `posts`, and then executed an invalid
insert. Wrangler returned `no such table: table_that_does_not_exist`. A fresh
remote inspection proved all-or-original behavior:

- the original `posts` definition remained;
- the original row and body remained;
- `posts_next` was absent; and
- `PRAGMA foreign_keys` returned `1`.

The disposable database was deleted after inspection. This observation covers
the actual remote import path and a failure after the first destructive
drop/rename pair. It supplements, rather than replaces, D1 Time Travel and the
runner's fail-closed intermediate-state probes.

Before production, the ordered column inventory must cover all live shards.
The 2026-08-13 inventory found two `assets` orders across 106 shards, but the
same 63-column set on every shard. The other three rebuilt tables had identical
sets and order. Migration 1158 uses explicit source and destination lists, so
neither order is positional input to the rebuild.

## Partial rebuild incident procedure

The runner treats any `posts_next`, `assets_next`,
`post_publish_requests_next`, or `moderation_actions_next` table as blocking
`partial_objects`. It must never rerun 1158 against that state.

If a shard is reported as partial:

1. Stop the fleet run. Preserve its manifest, resume ledger, exact Core and API
   commits, migration checksum, database name, and failure output.
2. Quarantine the shard through the reviewed quarantine process so application
   traffic cannot compound the state. Do not issue an unreviewed production SQL
   write.
3. Record the incident-time D1 Time Travel bookmark and the timestamp immediately
   before that shard's apply attempt.
4. Prefer restoring the shard to the pre-apply bookmark with the reviewed D1
   Time Travel procedure. This restores the whole import boundary and avoids
   reconstructing which of the four rebuilds completed.
5. After restore, verify all four canonical tables exist, all four `*_next`
   tables are absent, `PRAGMA foreign_keys = 1`, `PRAGMA foreign_key_check`
   returns no rows, and row counts match the runner's pre-apply `row_counts`.
   Confirm that the 1158 ledger row is absent, then run a read-only single-shard
   classification before removing quarantine.

If Time Travel restore is unavailable, manual completion requires a reviewed,
single-shard repair file built from the observed state:

1. For each pair where the canonical table is absent and its `*_next` table is
   present, complete only that rename. Never drop another table and never replay
   the migration from the beginning.
2. Establish all four canonical table names before applying any remaining tail.
   Apply `PRAGMA foreign_keys = ON` outside an explicit transaction.
3. Verify pre-apply row counts for all four rebuilt tables and run
   `PRAGMA foreign_key_check`. A mismatch stops repair and requires Time Travel
   or data-restoration review.
4. Build the remaining migration tail from the exact failed statement boundary
   and apply it through the reviewed single-shard break-glass path. The tail must
   create every required payload, enforcement, learning, trigger, and index
   object.
5. Insert the 1158 ledger row only after the normal classifier reports every
   schema marker and final index present, every forbidden `*_next` table absent,
   and the migration checksum exact. Re-run the full read-only classifier before
   removing quarantine.

Time Travel is the normal recovery path. Manual completion is an incident-only
fallback and requires review of the exact shard state; this document is not
authorization for raw production `wrangler d1 execute` writes.
