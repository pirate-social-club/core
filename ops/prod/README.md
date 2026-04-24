# Prod Ops Config

This directory is retained as the older human-only Infisical project config boundary.
It is not the current fastest path for launch operations.

Current launch state:

- prod secrets live in the same root Infisical project as dev and staging
- use the repo-root `.infisical.json`
- select production with `--env prod`
- use `/services/api` for runtime read-only checks
- use `/services/control-plane` for migrator/maintenance commands

Rules:

- do not commit `ops/prod/.infisical.json`
- do not put copied prod secret values in this directory

Current commands:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk infisical run --env prod --path /services/api -- \
  rtk bun scripts/control-plane/inventory-control-plane.ts \
  --database-url-env CONTROL_PLANE_DATABASE_URL \
  --format text
```

Reset app data while preserving applied migrations:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk infisical run --env prod --path /services/control-plane -- \
  rtk bun scripts/control-plane/reset-control-plane-app-data.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --execute \
  --confirm-reset prod-app-data
```

Migration command:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk infisical run --env prod --path /services/control-plane -- \
  rtk bun scripts/control-plane/apply-postgres-migrations.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --migrations db/control-plane/migrations \
  --label control-plane
```

Use the full operator checklist here:

- [production-infisical-human-only-checklist.md](../../docs/runbooks/production-infisical-human-only-checklist.md)
