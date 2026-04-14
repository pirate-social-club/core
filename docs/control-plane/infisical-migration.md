# Infisical Migration

Phase the `pirate-v2` Infisical migration deliberately. Do not copy the old `pirate/` secret surface forward wholesale.

## Phase 1

Create a fresh `pirate-v2` Infisical project and populate only:

- `dev:/contracts/story`
  - `STORY_CONTRACT_OWNER_PRIVATE_KEY`

This is the only secret required to run the current Story delivery deploy script at [deploy.sh](../../pirate-contracts/story/delivery/scripts/deploy.sh).

Non-secret deploy inputs stay outside Infisical:

- `RPC_URL`
- `PUBLISH_OPERATOR`
- `SETTLEMENT_OPERATOR`
- `ACCESS_PROOF_SIGNER`
- `OWNER_ADDRESS`

These resolve from repo config and operator-supplied env, not from Infisical.

### Bootstrap Commands

After `infisical login` and project selection, you can create the minimal Phase 1/2 tree with:

```bash
export STORY_CONTRACT_OWNER_PRIVATE_KEY=...
rtk ./scripts/bootstrap-infisical-story.sh
```

If you also want the Phase 2 runtime keys in place immediately:

```bash
export LIT_CHIPOTLE_OPERATOR_API_KEY=...
export LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY=...
export LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY=...
rtk ./scripts/bootstrap-infisical-story.sh
```

The helper creates only:

- `dev:/contracts/story`
- `dev:/services/api` when one or more runtime usage keys are provided

## Phase 2

Populate the runtime Lit usage-key path when API-side publish and access flows are ready:

- `dev:/services/api`
  - `LIT_CHIPOTLE_OPERATOR_API_KEY`
  - `LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY`
  - `LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY`

Add the remaining Story usage keys only when the corresponding families are in active use.

## Phase 2.5: Market Context Runtime Keys

Populate `dev:/services/api` with market-context runtime secrets only when the feature is active:

- `OPENROUTER_API_KEY`
- `JINA_API_KEY` when using authenticated Jina Reader access
- `PREDICT_FUN_API_KEY` when enabling Predict.fun as an approved provider
- `FIRECRAWL_API_KEY` only if Firecrawl is enabled as a crawler fallback

Jina Reader base URLs, OpenRouter model names, provider base URLs, score thresholds, and TTLs are not secrets. Keep them in version-controlled config or ordinary worker env.

Bootstrap helper:

```bash
export OPENROUTER_API_KEY=...
export JINA_API_KEY=... # optional but recommended for higher Reader limits
export PREDICT_FUN_API_KEY=... # optional, only for approved-provider integration
export FIRECRAWL_API_KEY=... # optional
rtk ./scripts/bootstrap-infisical-api.sh
```

## Explicitly Deferred

Do not pre-populate these paths during the initial Story delivery migration:

- `dev:/contracts/base`

Base deployment is out of scope for the current contract surface. Avoid copying Base secrets from `pirate/` out of habit.

## Turso Control Plane

Pirate's Turso architecture uses:

- one central control-plane database
- one Turso group per community
- one primary community database per group in v0

That secret surface should be introduced deliberately.

### Runtime path

Populate `dev:/services/api` only with:

- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_COMMUNITY_DB_WRAP_KEY`

Do not store one Turso auth token per community in Infisical.

Per-community database tokens are high-cardinality generated credentials. They should be encrypted with `TURSO_COMMUNITY_DB_WRAP_KEY` and stored in the central control-plane database.

### Provisioning path

Populate `dev:/services/control-plane` with:

- `CONTROL_PLANE_MIGRATOR_DATABASE_URL`
- `TURSO_PLATFORM_API_TOKEN`

This key is for provisioning:

- create community groups
- create community primary databases
- mint community database tokens
- transfer community groups during sovereignty handoff

It must not be present in the public API worker runtime.

Non-secret Turso config stays outside Infisical:

- `TURSO_ORGANIZATION_SLUG`
- naming conventions for groups and databases

Bootstrap helper:

```bash
export TURSO_PLATFORM_API_TOKEN=...
export CONTROL_PLANE_DATABASE_URL=...
export CONTROL_PLANE_MIGRATOR_DATABASE_URL=...
export TURSO_COMMUNITY_DB_WRAP_KEY=...
rtk ./scripts/bootstrap-infisical-control-plane.sh
rtk ./scripts/bootstrap-infisical-turso.sh
```

### API Runtime Secrets

Populate `/services/api` with the API runtime secrets that should not live in version-controlled worker config:

- `AUTH_UPSTREAM_JWT_SHARED_SECRET`
- `PIRATE_APP_JWT_PRIVATE_KEY`
- `PIRATE_APP_JWT_PUBLIC_KEY`
- `PRIVY_APP_SECRET`
- `PRIVY_JWT_VERIFICATION_KEY`
- `SPACES_VERIFIER_AUTH_TOKEN`
- `FILEBASE_S3_ACCESS_KEY`
- `FILEBASE_S3_SECRET_KEY`
- `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`

Bootstrap helper:

```bash
export AUTH_UPSTREAM_JWT_SHARED_SECRET=...
export PIRATE_APP_JWT_PRIVATE_KEY=...
export PIRATE_APP_JWT_PUBLIC_KEY=...
export PRIVY_APP_SECRET=...
rtk ./scripts/bootstrap-infisical-api-runtime.sh
```

Keep non-secret runtime config outside Infisical:

- `AUTH_UPSTREAM_JWT_ISSUER`
- `AUTH_UPSTREAM_JWT_AUDIENCE`
- `PIRATE_API_PUBLIC_ORIGIN`
- `PRIVY_APP_ID`
- `PRIVY_API_URL`
- `SPACES_VERIFIER_BASE_URL`

You may omit any variable you do not want to write yet. Each helper writes only the env vars that are present.
For the intended secret split, bootstrap both `CONTROL_PLANE_DATABASE_URL` and `CONTROL_PLANE_MIGRATOR_DATABASE_URL`.

### Registry Publisher Secrets

Tableland publication is deferred for launch.

Do not provision `/services/registry-publisher` or publisher-specific secrets in
the current launch environment.

Operator env management:

- keep checked operator env templates in:
  - [scripts/.env.operator-staging.example](../../scripts/.env.operator-staging.example:1)
  - [scripts/.env.operator-production.example](../../scripts/.env.operator-production.example:1)
- source those env files through [scripts/operator-env-run.sh](../../scripts/operator-env-run.sh:1) instead of repeating inline `set -a; source ...; set +a`
- sync Cloudflare worker secrets from either the checked local env file or Infisical with [scripts/sync-wrangler-api-secrets.sh](../../scripts/sync-wrangler-api-secrets.sh:1)
- keep only true secrets in Infisical:
  - `/services/control-plane` -> `TURSO_PLATFORM_API_TOKEN`
  - `/services/api` -> `TURSO_COMMUNITY_DB_WRAP_KEY`
  - `/services/api` -> `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`
- keep non-secrets outside Infisical:
  - `TURSO_ORGANIZATION_SLUG`
  - `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION`
  - `COMMUNITY_PROVISION_OPERATOR_HOST`
  - `COMMUNITY_PROVISION_OPERATOR_PORT`
  - `REGISTRY_PUBLISHER_HOST`
  - `REGISTRY_PUBLISHER_PORT`
  - `REGISTRY_PUBLISHER_CHAIN_ID`

Keep the break-glass owner URL outside service paths, for example:

- `dev:/local/control-plane` -> `CONTROL_PLANE_OWNER_DATABASE_URL`

## Control Plane

`LIT_CHIPOTLE_ACCOUNT_API_KEY` must not be present in worker runtime env.

If control-plane automation later needs it, create a separate path such as:

- `dev:/local/lit`

Do not place that key under `dev:/services/api`, and do not create it until control-plane tooling actually exists.

## Not Carried Forward

Do not migrate these legacy fallback secrets from `pirate/`:

- `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY`
- `MUSIC_PURCHASE_BASE_TREASURY_PRIVATE_KEY`
- `STORY_OPERATOR_PRIVATE_KEY`
- `STORY_ACCESS_CONTROLLER_PRIVATE_KEY`
- `STORY_FEED_REGISTRAR_PRIVATE_KEY`
- `STORY_SCROBBLE_OPERATOR_PRIVATE_KEY`

The v2 policy is PKP-only for those families.
