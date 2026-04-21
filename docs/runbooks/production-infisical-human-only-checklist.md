# Production Infisical Human-Only Checklist

Use this from a human-only shell that is not attached to Codex.

Do not paste secret values into chat.

Current hosted shape:

- non-prod Infisical project: `pirate-dev-staging`
- prod Infisical project: `pirate-prod`
- hosted production environment slug: `prod`
- repo root `.infisical.json`: non-prod only
- `ops/prod/.infisical.json`: human-local prod only and must not be committed

Current prod status:

- `pirate-prod` already has the required folder tree
- required prod secret keys already exist as placeholders with value `__HUMAN_SET_REQUIRED__`
- production is not ready until every placeholder is replaced with a real value

## Stop/Go Gate 0: Contract

Before touching `prod`, verify `scripts/lib/infisical-env-contract.ts` still matches the intended policy.

Must apply to hosted `prod`:

- `AUTH_UPSTREAM_JWT_SHARED_SECRET`
- `PIRATE_APP_JWT_PRIVATE_KEY`
- `PIRATE_APP_JWT_PUBLIC_KEY`
- `PRIVY_APP_SECRET`
- `STORY_RUNTIME_PRIVATE_KEY`
- `STORY_OPERATOR_PRIVATE_KEY`
- `STORY_CDR_WRITER_PRIVATE_KEY`
- `STORY_ACCESS_CONTROLLER_PRIVATE_KEY`
- `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY`

Must stay excluded from normal hosted `prod`:

- `CONTROL_PLANE_OWNER_DATABASE_URL`
- `STORY_CONTRACT_OWNER_PRIVATE_KEY`
- `LIT_CHIPOTLE_*` until the hosted runtime deliberately switches to PKP/Lit mode
- `REGISTRY_PUBLISHER_AUTH_TOKEN` until `REGISTRY_PUBLISHER_URL` is configured

Stop if this is not true.

## Stop/Go Gate 1: Human-Only Shell and Prod Config

Open a separate shell with no Codex attached.

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical login
rtk infisical init
```

When `rtk infisical init` prompts for a project, select `pirate-prod`.

Confirm:

- `ops/prod/.infisical.json` now points at `pirate-prod`
- `prod` environment exists

Stop if `prod` does not exist.

## Step 1: Verify Current Scaffold

From `ops/prod`, confirm the current placeholder state:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk bun ../../scripts/infisical/check-infisical-env.ts --env prod
```

Expected before real values are set:

- folders pass:
  - `/services`
  - `/services/api`
  - `/services/control-plane`
- required secrets fail as `invalid: human-set placeholder`

Stop if the folder tree is missing.

## Step 2: Split Production DB Roles

Export the owner-capable production URL only in the human-only shell:

```bash
export CONTROL_PLANE_OWNER_DATABASE_URL='postgresql://...'
```

Run:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk bun ../../scripts/control-plane/split-control-plane-roles.ts \
  --infisical-env prod \
  --skip-infisical \
  --allow-missing-pgaudit
```

Capture from output:

- `runtime_url`
- `migrator_url`
- `owner_url`

Go only if:

- runtime URL exists
- migrator URL exists
- owner URL stays outside normal hosted Infisical

## Step 3: Generate Production Secrets

Generate:

```bash
export AUTH_UPSTREAM_JWT_SHARED_SECRET="$(openssl rand -hex 32)"
export TURSO_COMMUNITY_DB_WRAP_KEY="$(openssl rand -hex 32)"
export COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Generate Pirate app JWT RSA keys:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out /tmp/pirate-app-jwt-private.pem
openssl rsa -pubout -in /tmp/pirate-app-jwt-private.pem -out /tmp/pirate-app-jwt-public.pem
```

Obtain and export:

```bash
export PRIVY_APP_SECRET='...from production Privy app...'
export TURSO_PLATFORM_API_TOKEN='...from production Turso operator flow...'
export CONTROL_PLANE_DATABASE_URL='...runtime_url...'
export CONTROL_PLANE_MIGRATOR_DATABASE_URL='...migrator_url...'
```

Go only if all required shell vars are set.

## Step 4: Replace Prod Placeholders With Real Values

Set `/services/api`:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical secrets set \
  CONTROL_PLANE_DATABASE_URL="$CONTROL_PLANE_DATABASE_URL" \
  TURSO_COMMUNITY_DB_WRAP_KEY="$TURSO_COMMUNITY_DB_WRAP_KEY" \
  AUTH_UPSTREAM_JWT_SHARED_SECRET="$AUTH_UPSTREAM_JWT_SHARED_SECRET" \
  PRIVY_APP_SECRET="$PRIVY_APP_SECRET" \
  STORY_RUNTIME_PRIVATE_KEY="$STORY_RUNTIME_PRIVATE_KEY" \
  STORY_OPERATOR_PRIVATE_KEY="$STORY_OPERATOR_PRIVATE_KEY" \
  STORY_CDR_WRITER_PRIVATE_KEY="$STORY_CDR_WRITER_PRIVATE_KEY" \
  STORY_ACCESS_CONTROLLER_PRIVATE_KEY="$STORY_ACCESS_CONTROLLER_PRIVATE_KEY" \
  MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY="$MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY" \
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN="$COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN" \
  --env prod --path /services/api
```

Set the Pirate app JWT PEMs from files:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical secrets set \
  PIRATE_APP_JWT_PRIVATE_KEY=@/tmp/pirate-app-jwt-private.pem \
  PIRATE_APP_JWT_PUBLIC_KEY=@/tmp/pirate-app-jwt-public.pem \
  --env prod --path /services/api
```

Set `/services/control-plane`:

`TURSO_COMMUNITY_DB_WRAP_KEY` and `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` must exactly match `/services/api`.

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical secrets set \
  CONTROL_PLANE_MIGRATOR_DATABASE_URL="$CONTROL_PLANE_MIGRATOR_DATABASE_URL" \
  TURSO_PLATFORM_API_TOKEN="$TURSO_PLATFORM_API_TOKEN" \
  TURSO_COMMUNITY_DB_WRAP_KEY="$TURSO_COMMUNITY_DB_WRAP_KEY" \
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN="$COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN" \
  --env prod --path /services/control-plane
```

## Step 5: Verify Production Secret Contract

First do the non-connect doctor:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk bun ../../scripts/infisical/check-infisical-env.ts --env prod
rtk bun ../../scripts/infisical/check-infisical-env.ts --env prod --profile commerce
```

Then do the live DB-connect doctor:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk bun ../../scripts/infisical/check-infisical-env.ts --env prod --profile commerce --connect
```

Go only if all checks pass.

This must verify:

- environment exists
- required folders exist
- required secrets exist with no placeholder values left
- undeclared live folders/secrets are absent
- runtime and migrator DB URLs connect
- runtime and migrator point at the same DB host
- runtime and migrator use different roles
- runtime uses `control_plane_api_rw`
- migrator uses `control_plane_migrator`
- runtime has DML-only privilege shape
- migrator has DDL + DML privilege shape
- wrap key matches across both paths
- operator auth token matches across both paths

## Step 6: Apply Production Migrations

Run the control-plane migrations using the prod config boundary:

```bash
cd /home/t42/Documents/pirate-v2/ops/prod
rtk infisical run --project-config-dir=. --env prod -- \
  rtk bun ../../scripts/control-plane/apply-postgres-migrations.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --migrations ../../db/control-plane/migrations \
  --label control-plane
```

Go only if:

- migrations succeed without owner fallback
- `schema_migrations` is current
- the latest checked-in migration in `db/control-plane/migrations/` is present in `schema_migrations`

## Step 7: Production App Smoke Check

Run one human-verified production-config startup or smoke check.

Go only if:

- app boots
- no required env vars are missing
- auth init succeeds
- community provisioning init succeeds if it is in launch scope

## Step 8: Cleanup

```bash
rm -f /tmp/pirate-app-jwt-private.pem /tmp/pirate-app-jwt-public.pem
unset CONTROL_PLANE_OWNER_DATABASE_URL
unset CONTROL_PLANE_DATABASE_URL
unset CONTROL_PLANE_MIGRATOR_DATABASE_URL
unset AUTH_UPSTREAM_JWT_SHARED_SECRET
unset TURSO_COMMUNITY_DB_WRAP_KEY
unset COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN
unset PRIVY_APP_SECRET
unset TURSO_PLATFORM_API_TOKEN
rtk infisical reset
```

Close the shell.

## Done

Production is ready only if all of these are true:

- every `__HUMAN_SET_REQUIRED__` placeholder has been replaced
- doctor passed with `--connect`
- migrations are current
- app smoke check passed
- owner credential stayed outside normal hosted Infisical
- Story production signing stayed outside Infisical
