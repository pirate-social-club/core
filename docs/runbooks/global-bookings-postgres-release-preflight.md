# Global Bookings Postgres Release Preflight

Use this before the first global bookings migration apply in each shared environment.
The bookings migrations live in `db/bookings/migrations` and run against the same
Postgres cluster as the control-plane database, but they create their own `bookings`
schema and use the shared `public.schema_migrations` ledger.

As of June 29, 2026, staging owner preflight was applied manually once and the
focused live staging hold/quote smoke passed against API `3065bbb`. Still run the
verification section before rerunning release. Production needs the same preflight
before its first bookings migration apply.

## Required Admin Actions

1. Grant the web Release OIDC identity read access to the control-plane migrator
   secret:
   - identity: `a7b5d0b2-0891-4b63-b0e6-946a8c513458`
   - environment: `staging` or `prod`
   - path: `/services/control-plane`
   - secret: `CONTROL_PLANE_MIGRATOR_DATABASE_URL`

2. Using the owner database URL, enable `btree_gist` and grant the migrator role
   the DDL privileges needed by `b0001_bookings_global_schema.sql`.

The migrator is intentionally non-superuser. It cannot install `btree_gist` unless
the extension is already available and installed by an owner/admin. It also needs
database-level `CREATE` to create/own `bookings`, and schema-level `CREATE` on
`public` for the shared migration ledger path.

## Owner Preflight

Use the correct Infisical profile before reading secrets:

```bash
printf '\n' | rtk infisical user switch >/dev/null
```

Load the owner URL without printing it:

```bash
export CONTROL_PLANE_OWNER_DATABASE_URL="$(
  rtk infisical secrets get CONTROL_PLANE_OWNER_DATABASE_URL \
    --env staging \
    --path /local/control-plane \
    --projectId 5acea78e-7813-4d8a-b29c-9b862a0b1c71 \
    --plain
)"
```

For production, change `--env staging` to `--env prod`.

Run the owner preflight. If the migrator role name is not
`control_plane_migrator`, replace it before running.

```bash
rtk psql "$CONTROL_PLANE_OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  migrator_role text := 'control_plane_migrator';
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), migrator_role);
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', migrator_role);
END $$;
SQL
```

## Owner Verification

Run this as owner/admin:

```bash
rtk psql "$CONTROL_PLANE_OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'btree_gist';

SELECT
  current_database() AS database_name,
  has_database_privilege('control_plane_migrator', current_database(), 'CREATE') AS migrator_can_create_database_objects,
  has_schema_privilege('control_plane_migrator', 'public', 'USAGE') AS migrator_can_use_public,
  has_schema_privilege('control_plane_migrator', 'public', 'CREATE') AS migrator_can_create_in_public;
SQL
```

Expected:

- one `btree_gist` row
- all three privilege columns are `t`

If the environment uses a different migrator role, replace
`control_plane_migrator` in the verification query with that role.

## Migrator Verification

After the Infisical identity grant, verify the migrator can read its own URL and
has the required privileges. Load the migrator URL without printing it:

```bash
export CONTROL_PLANE_MIGRATOR_DATABASE_URL="$(
  rtk infisical secrets get CONTROL_PLANE_MIGRATOR_DATABASE_URL \
    --env staging \
    --path /services/control-plane \
    --projectId 5acea78e-7813-4d8a-b29c-9b862a0b1c71 \
    --plain
)"
```

For production, change `--env staging` to `--env prod`.

Run:

```bash
rtk psql "$CONTROL_PLANE_MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  current_user AS migrator_user,
  current_database() AS database_name,
  EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'
  ) AS has_btree_gist,
  has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
  has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
  to_regclass('public.schema_migrations') IS NOT NULL AS has_schema_migrations;
SQL
```

Expected:

- `has_btree_gist = t`
- `can_create_database_objects = t`
- `can_use_public = t`
- `can_create_in_public = t`
- `has_schema_migrations = t` on existing control-plane databases

## Migration Dry Check

The release workflow applies both roots:

```bash
rtk bun scripts/control-plane/apply-postgres-migrations.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --migrations db/control-plane/migrations \
  --label control-plane

rtk bun scripts/control-plane/apply-postgres-migrations.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --migrations db/bookings/migrations \
  --label bookings
```

There is no dry-run mode. If you run these manually, treat it as the real apply.
Successful output for an already-prepared environment should either apply pending
files or report them skipped from `schema_migrations`.

## Release Rerun

After the identity grant and database preflight are verified:

1. Rerun web `Release` on `main`.
2. Confirm `Fetch staging control-plane migration secret` succeeds.
3. Confirm `Apply staging control-plane migrations` succeeds.
4. Confirm `Apply staging bookings migrations` succeeds.
5. Confirm `Verify global booking staging smoke` succeeds.

The focused live smoke proves:

- host profile write
- availability rule write
- publish
- global slot resolution
- hold creation in `bookings.holds`
- slot-lock exclusion path in `bookings.host_slot_locks`
- quote creation

## Production Notes

Before production release, repeat the same identity grant and owner preflight for
`prod`. Global bookings is greenfield: there are no existing global booking rows
to backfill before the first schema apply. The required production work is the
schema preflight, migration apply, deploy, and focused booking smoke.
