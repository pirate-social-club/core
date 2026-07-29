# Database Migrations

Pirate has four relational migration roots:

- `db/control-plane/migrations/`
  Central Pirate-owned control-plane schema for identity, auth links, verification, community routing, encrypted community credentials, projections, jobs, and audit.
- `db/community-template/migrations/`
  Baseline per-community schema applied to each new community `main` database at provisioning time.
- `db/bookings/migrations/`
  Global bookings schema hosted in the control-plane PostgreSQL cluster.
- `db/promotion/migrations/`
  Independently versioned release-promotion state. The initial root is shadow-only.

Runtime note:

- `db/` is the canonical migration source for operational docs and bootstrap commands.
- The API test suite (`api/services/api/tests/helpers.ts`) uses a SQLite-compatible baseline snapshot (`api/services/api/tests/fixtures/control-plane-baseline-sqlite.sql`) derived from the canonical Postgres schema. The historical migration chain in `db/control-plane/migrations/` is PostgreSQL-first and cannot be replayed against SQLite/libSQL. When the canonical schema changes, the test fixture must be regenerated.
- Keep the community-template trees in sync.

Related docs:

- [control-plane-schema.md](../docs/control-plane/control-plane-schema.md)

## Current Scope

These migrations are the first executable baseline, not the final full product schema.

Current posture:

- control-plane migrations are intended to be real and durable
- community-template migrations intentionally cover only the stable v0 sovereignty core
- richer commerce, analytics, and read-model denormalizations can be added later in new migrations

Current post visibility schema:

- community DB `posts.visibility`
  `public | members_only`
- control-plane `community_post_projections.visibility`
  mirrors the community post row for public-route and feed filtering

## Ordering

Migration order is defined by the filenames in the filesystem, not by this README.

Prefix rule:

- each migration filename prefix must be unique within its migration root
- the current runner applies files in lexicographic order and only warns on duplicate prefixes
- do not rely on duplicate numeric prefixes to imply a stable order
- `0080_control_plane_link_enrichment_source_language.sql` and
  `0080_control_plane_song_artifact_bundle_title.sql` are a known historical
  duplicate in the control-plane root. Keep both names stable because production
  ledgers have recorded them separately. New migrations must use a fresh prefix.

Use the directories themselves as the authoritative source:

- `db/control-plane/migrations/`
  Fresh Postgres targets start from `0000_control_plane_baseline_postgres.sql`.
  Historical control-plane sequence then continues through the latest checked-in migration.
- `db/community-template/migrations/`
  Current community-template sequence starts at `1001_...` and continues through the latest checked-in migration.

Production applies the complete pending sequence, not a feature-selected subset. Before every apply:

- query the live `schema_migrations` ledger and compare it with the exact checked-out migration root
- review every pending file, including migrations owned by unrelated workstreams
- notify those owners before applying their migrations as part of another rollout
- record the exact applied set and aggregate data effects in the rollout evidence

Once recorded in a production ledger, a migration file is immutable; later schema changes require a
new migration. A merged dark feature is not evidence that its schema has reached production, and a
missing table must never be treated as an intentional feature gate.

For Postgres control-plane runs, the migration runner treats `0000_control_plane_baseline_postgres.sql`
as a fresh-database snapshot that supersedes the historical `0001_...0046_...` chain.
It will:

- apply the baseline on fresh Postgres targets
- skip the historical SQLite-first files after the baseline is applied
- skip the baseline on databases that already recorded the historical migrations
- tolerate checksum drift for the baseline row on already-bootstrapped Postgres
  databases, because the baseline is a snapshot and not a replayed historical
  migration there. Regular migration checksum drift still fails.

Keep this README descriptive rather than maintaining a duplicated file-by-file index that can drift from the actual migration roots.

## Local Apply

Until a runtime repo grows its own migration command, this repo provides:

- a local SQLite/libSQL migration runner for community workflows
- a Postgres migration runner for the Neon-backed control plane

Postgres / Neon:

```bash
rtk infisical run --env dev --path /services/control-plane -- \
  bun scripts/control-plane/apply-postgres-migrations.ts \
    --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
    --migrations db/control-plane/migrations \
    --label control-plane
```

Global bookings ledger (own `bookings` schema, hosted in the same control-plane Postgres cluster, same
migrator role/URL — applied as a separate root with its own `bookings` label):

```bash
rtk infisical run --env dev --path /services/control-plane -- \
  bun scripts/control-plane/apply-postgres-migrations.ts \
    --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
    --migrations db/bookings/migrations \
    --label bookings
```

Preflight (once per database, before the first `b0001_` apply) — the non-superuser migrator cannot do
these itself:

- Owner/PlanetScale enables the extension: `CREATE EXTENSION IF NOT EXISTS btree_gist;` (required by the
  `host_slot_locks` range-exclusion constraint).
- The migrator role needs `CREATE ON DATABASE <db>` (to create + own the `bookings` schema) and `CREATE
  ON SCHEMA public` (to own the shared `public.schema_migrations` ledger — already held on the
  established control-plane DB). Local bookings development requires a real Postgres: the exclusion
  constraint cannot be emulated in SQLite, so do not bootstrap bookings against the libSQL community runner.

SQLite/libSQL community template:

```bash
rtk bash scripts/community/apply-sqlite-migrations.sh \
  --db /tmp/pirate-community-template.db \
  --migrations db/community-template/migrations \
  --label community-template
```

The runner:

- applies `.sql` files in lexicographic order
- records successful applications in `schema_migrations`
- skips already-applied migrations when the checksum matches
- fails if a previously applied migration file has changed

## Local Fixtures

Control-plane fixture seed for the JWT-first, no-browser path:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/control-plane/seed-control-plane-fixtures.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id usr_demo_01 \
    --subject demo-subject-01 \
    --handle demo \
    --namespace-label demo
```

Local community bootstrap using the seeded namespace verification:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/community/bootstrap-community-slice.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --community-db /tmp/pirate-community-demo.db \
    --community-id cmt_demo_01 \
    --user-id usr_demo_01 \
    --display-name "Demo Community" \
    --namespace-verification-id nv_demo_usr_demo_01 \
    --namespace-label demo
```

## Notes

- The community migration files target SQLite-compatible DDL for D1 and the local libSQL harness.
- The control-plane migration files are PostgreSQL-first and apply directly to Neon from `db/control-plane/migrations/`.
- Post visibility is part of the mainline schema now. New environments should include both the community `posts.visibility` column and the control-plane `community_post_projections.visibility` column from the checked-in migrations and baseline snapshot.
- Community databases intentionally do not define a `users` table. They reference central Pirate `user_id` values as foreign identifiers, not local user rows.
- This repo now includes migration runners in [scripts/community/apply-sqlite-migrations.sh](../scripts/community/apply-sqlite-migrations.sh) and [scripts/control-plane/apply-postgres-migrations.ts](../scripts/control-plane/apply-postgres-migrations.ts), plus [scripts/control-plane/seed-control-plane-fixtures.ts](../scripts/control-plane/seed-control-plane-fixtures.ts) and [scripts/community/bootstrap-community-slice.ts](../scripts/community/bootstrap-community-slice.ts) for Neon-backed local slice bootstrapping.
