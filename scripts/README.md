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
  Infisical contract/bootstrap commands and Wrangler secret sync helpers.
- `story/`
  Story-specific operator helpers.
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
- `scripts/control-plane/provision-promotion-shadow-role.ts`
  Provision the least-privilege S0 promotion role after the promotion migration,
  failing closed on unsafe `PUBLIC TEMP`, cross-database `CONNECT`, or routine
  execution baselines.
- `scripts/control-plane/harden-control-plane-postgres.ts`
  Apply control-plane hardening such as `schema_migrations` grants and FORCE RLS. It can attempt
  pgAudit when the Neon plan supports it, but pgAudit is not part of the current launch baseline.
- `scripts/control-plane/inventory-control-plane.ts`
  Read-only inventory for control-plane state and likely fixture contamination.
- `scripts/control-plane/inspect-control-plane-migration-ledger.ts`
  Read-only comparison of a control-plane `schema_migrations` ledger against the checked Postgres migration root.
- `scripts/control-plane/reset-control-plane-app-data.ts`
  Truncate control-plane app data while preserving `schema_migrations`; dry-run by default and requires explicit confirmation to execute.
### Community

- `scripts/community/apply-sqlite-migrations.sh`
  Apply `db/community-template/migrations` to a SQLite or libSQL target.
- `scripts/community/bootstrap-community-db.sh`
  Bootstrap a local community DB from the community template.
- `scripts/community/verify-song-study-ga-schema.ts`
  Verify a SQLite/libSQL community DB mirror has the Study due-review/streak GA schema shape after
  the 1121 attempt-identity migration.

### Infisical

- `scripts/infisical/bootstrap-infisical.ts`
  Write the current secret contract into Infisical.
- `scripts/infisical/check-infisical-env.ts`
  Validate the Infisical contract, with optional live DB checks.
- `scripts/infisical/check-wrangler-api-secrets.ts`
  Audit the deployed API worker secret names against the intended Wrangler secret surface.
- `scripts/infisical/sync-wrangler-api-secrets.sh`
  Push the API runtime secret surface into the worker.

### Story

- `scripts/story/provision-story-runtime-signers.ts`
  Generate missing direct Story runtime signer keys in Infisical.

## Current Secret Shape

The active paid-song mainline uses direct private keys from Infisical `/services/api`:

- `STORY_OPERATOR_PRIVATE_KEY`
- `STORY_ENTITLEMENT_CLASS_CONFIGURER_PRIVATE_KEY`
- `STORY_CDR_WRITER_PRIVATE_KEY`
- `STORY_ACCESS_CONTROLLER_PRIVATE_KEY`
- `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY`

`STORY_CONTRACT_OWNER_PRIVATE_KEY` stays local and operator-only. The usual local file is
`scripts/.env.operator-dev`, which remains untracked on purpose.

## Examples

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
