# Scripts

`scripts/` holds the current human-run operational entrypoints for `core`.

It is intentionally narrow:

- only active mainline tooling stays here
- top-level `scripts/` is now just folders plus this index
- shared implementation stays in `scripts/lib/`
- historical helpers, removed registry tooling, extraction helpers, and benchmark data do not belong here

## Layout

- `control-plane/`
  Postgres control-plane migration, role, inventory, and reconciliation commands.
- `community/`
  SQLite community-template migration and local community bootstrap commands.
- `infisical/`
  Infisical contract/bootstrap commands, operator env wrapper, and checked env templates.
- `story/`
  Story-specific operator helpers.
- `turso/`
  Turso provisioning, operator server, and Turso maintenance commands.
- `lib/`
  Shared tested logic used by the entrypoints above.

## Mainline Commands

### Control Plane

- `scripts/control-plane/apply-postgres-migrations.ts`
  Apply `db/control-plane/migrations` to a Postgres target.
- `scripts/control-plane/seed-control-plane-fixtures.ts`
  Seed deterministic fixture users and namespace state.
- `scripts/control-plane/split-control-plane-roles.ts`
  Split runtime and migrator roles and optionally write the resulting URLs to Infisical.
- `scripts/control-plane/harden-control-plane-postgres.ts`
  Apply control-plane hardening such as `schema_migrations` grants and FORCE RLS. It can attempt
  pgAudit when the Neon plan supports it, but pgAudit is not part of the current launch baseline.
- `scripts/control-plane/inventory-control-plane.ts`
  Read-only inventory for control-plane state and likely fixture contamination.
- `scripts/control-plane/inspect-control-plane-migration-ledger.ts`
  Read-only comparison of a control-plane `schema_migrations` ledger against the checked Postgres migration root.
- `scripts/control-plane/reset-control-plane-app-data.ts`
  Truncate control-plane app data while preserving `schema_migrations`; dry-run by default and requires explicit confirmation to execute.
- `scripts/control-plane/reconcile-community-provisioning-state.ts`
  Promote valid `provisioning_state=error` communities back to `active`.

### Community

- `scripts/community/apply-sqlite-migrations.sh`
  Apply `db/community-template/migrations` to a SQLite or libSQL target.
- `scripts/community/apply-remote-community-migrations.ts`
  Dry-run or apply pending community-template migrations to active remote Turso/libSQL community DBs.
- `scripts/community/inspect-remote-community-migration-ledger.ts`
  Read-only inspection of one remote community DB migration ledger, including checksum-based rename candidates.
- `scripts/community/reconcile-remote-community-migration-ledgers.ts`
  Dry-run or apply checksum-proven `schema_migrations` ledger renames for active remote community DBs. It does not apply missing migrations.
- `scripts/community/bootstrap-community-db.sh`
  Bootstrap a local community DB from the community template.
- `scripts/community/bootstrap-community-slice.ts`
  Create the control-plane rows plus the local community DB for a local slice.
- `scripts/community/bootstrap-infinity-existing-user.sh`
  Seed the deterministic Infinity local scenario.

### Infisical

- `scripts/infisical/bootstrap-infisical.ts`
  Write the current secret contract into Infisical.
- `scripts/infisical/check-infisical-env.ts`
  Validate the Infisical contract, with optional live DB checks.
- `scripts/infisical/check-wrangler-api-secrets.ts`
  Audit the deployed API worker secret names against the intended Wrangler secret surface.
- `scripts/infisical/operator-env-run.sh`
  Source a checked operator env file and run a command under a named profile.
- `scripts/infisical/sync-wrangler-api-secrets.sh`
  Push the API runtime secret surface into the worker.
- `scripts/infisical/.env.operator-*.example`
  Checked templates for local operator env files.

### Story

- `scripts/story/provision-story-runtime-signers.ts`
  Generate missing direct Story runtime signer keys in Infisical.

### Turso

- `scripts/turso/turso-control-plane.ts`
  Private Turso provisioning CLI with `provision-community`, `rotate-community-token`, and `doctor`.
- `scripts/turso/turso-control-plane-operator.ts`
  Private HTTP operator used by the API worker for Turso-backed community provisioning.
- `scripts/turso/enforce-turso-delete-protection.ts`
  Enable delete protection for current Turso groups and databases.
- `scripts/turso/cleanup-orphaned-turso-resources.ts`
  Delete Turso groups and databases that have no control-plane binding rows.

## Current Secret Shape

The active paid-song mainline uses direct private keys from Infisical `/services/api`:

- `STORY_RUNTIME_PRIVATE_KEY`
- `STORY_OPERATOR_PRIVATE_KEY`
- `STORY_CDR_WRITER_PRIVATE_KEY`
- `STORY_ACCESS_CONTROLLER_PRIVATE_KEY`
- `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY`

`STORY_CONTRACT_OWNER_PRIVATE_KEY` stays local and operator-only. The usual local file is
`scripts/.env.operator-dev`, which remains untracked on purpose.

Turso uses the organization as the environment boundary. Community group/database names stay
community-id based, while the organization slug makes prod/staging/dev visually distinct:

| Environment | Turso organization slug |
| --- | --- |
| Dev | `pirate-dev` |
| Staging | `pirate-staging` |
| Production | `pirate-prod` |

Operator env files should set both `TURSO_ORGANIZATION_SLUG` and
`EXPECTED_TURSO_ORGANIZATION_SLUG` to the environment's slug. The operator refuses to start
when those values differ.

Local operator env files such as `scripts/.env.operator-dev` are intentionally untracked. Keep any
local SQLite or libSQL files under `scripts/.local/` instead of sidecar-private paths such as
`${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}/.local/`.

If you need to reuse an existing sidecar DB during the transition, copy it into the core-local
scratch directory:

```bash
rtk mkdir -p scripts/.local
PIRATE_API_DIR="${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}"
rtk cp "$PIRATE_API_DIR/.local/turso-live-smoke-control-plane.db" scripts/.local/
```

Then point the local operator env at:

```text
CONTROL_PLANE_DATABASE_URL=file:./scripts/.local/turso-live-smoke-control-plane.db
```

## Examples

Start the private Turso operator:

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file scripts/.env.operator-staging --profile turso-operator-server -- \
  rtk bun scripts/turso/turso-control-plane-operator.ts
```

Validate non-prod Infisical:

```bash
rtk bun scripts/infisical/check-infisical-env.ts --env staging --connect
```

Inventory prod control-plane data from the shared Infisical project:

```bash
rtk infisical run --env prod --path /services/api -- \
  rtk bun scripts/control-plane/inventory-control-plane.ts \
  --database-url-env CONTROL_PLANE_DATABASE_URL \
  --format text
```

Reset prod control-plane app data before launch, preserving migrations:

```bash
rtk infisical run --env prod --path /services/control-plane -- \
  rtk bun scripts/control-plane/reset-control-plane-app-data.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --execute \
  --confirm-reset prod-app-data
```

Bootstrap missing Story signer keys:

```bash
rtk bun scripts/story/provision-story-runtime-signers.ts --env dev
```

Sync worker secrets from Infisical:

```bash
rtk infisical run --env staging --path /services/api -- \
  rtk ./scripts/infisical/sync-wrangler-api-secrets.sh
```
