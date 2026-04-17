# Prod Ops Config

This directory is the human-only Infisical project config boundary for hosted production.

Rules:

- do not run prod Infisical commands from the repo root
- do not store prod secrets in the root `.infisical.json` project
- do not commit `ops/prod/.infisical.json`
- do not use this directory from AI-attached shells

Recommended shape:

- repo root `.infisical.json` -> non-prod project (`pirate-dev-staging`)
- `ops/prod/.infisical.json` -> prod-only project (`pirate-prod`)

Human-only setup:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical login
rtk infisical init
```

Select `pirate-prod` when `init` prompts for a project.

Current prod state:

- required prod folders already exist in `pirate-prod`
- required prod secret keys already exist as `__HUMAN_SET_REQUIRED__` placeholders
- production is not ready until a human replaces every placeholder

Minimal verification:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk bun ../../scripts/check-infisical-env.ts --env prod
rtk bun ../../scripts/check-infisical-env.ts --env prod --connect
```

Migration command:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical run --project-config-dir=. --env prod -- \
  rtk bun ../../scripts/apply-postgres-migrations.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --migrations ../../db/control-plane/migrations \
  --label control-plane
```

After use:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical reset
```

Use the full operator checklist here:

- [production-infisical-human-only-checklist.md](../../docs/runbooks/production-infisical-human-only-checklist.md)

If you use machine identity auth instead of local project config, prefer explicit project selection in the human-only runtime and keep that identity out of all AI-attached shells.

If `pirate-dev-staging` is only a rename of the existing non-prod project, the repo root
`.infisical.json` likely does not need to change. If repo root must point at a different project
ID, re-run `rtk infisical init` from the repo root in a human-approved shell.
