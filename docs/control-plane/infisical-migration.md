# Infisical Migration

Phase the `pirate-v2` Infisical migration deliberately. Do not copy the old `pirate/` secret surface forward wholesale.

## Phase 1

Create a fresh `pirate-v2` Infisical project and populate only the hosted service paths.

`STORY_CONTRACT_OWNER_PRIVATE_KEY` is no longer part of the Infisical contract. If you still use
the hot-key Story Foundry deploy path locally, pass that key as an operator-local env var instead
of storing it in Infisical.

Non-secret deploy inputs stay outside Infisical:

- `RPC_URL`
- `PUBLISH_OPERATOR`
- `SETTLEMENT_OPERATOR`
- `ACCESS_PROOF_SIGNER`
- `OWNER_ADDRESS`

These resolve from repo config and operator-supplied env, not from Infisical.

### Bootstrap Commands

The current mainline does not use Lit usage keys. When Story runtime work is active, seed the
direct runtime keys instead and write them through the unified bootstrap:

```bash
export CONTROL_PLANE_DATABASE_URL=...
export CONTROL_PLANE_MIGRATOR_DATABASE_URL=...
export STORY_RUNTIME_PRIVATE_KEY=...
export STORY_OPERATOR_PRIVATE_KEY=...
export STORY_CDR_WRITER_PRIVATE_KEY=...
export STORY_ACCESS_CONTROLLER_PRIVATE_KEY=...
export MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY=...
rtk bun scripts/infisical/bootstrap-infisical.ts --env dev
```

## Phase 2

Populate direct API runtime secrets only when the corresponding feature is actually in use.
Do not create placeholder Lit or PKP secret paths for future work.

## Phase 2.5: Market Context Runtime Keys

Populate `dev:/services/api` with market-context runtime secrets only when the feature is active:

- `OPENROUTER_API_KEY`
- `JINA_API_KEY` when using authenticated Jina Reader access
- `PREDICT_FUN_API_KEY` when enabling Predict.fun as an approved provider
- `FIRECRAWL_API_KEY` only if Firecrawl is enabled as a crawler fallback

Jina Reader base URLs, OpenRouter model names, provider base URLs, score thresholds, and TTLs are not secrets. Keep them in version-controlled config or ordinary worker env.

Bootstrap these through the same unified command:

```bash
export OPENROUTER_API_KEY=...
export JINA_API_KEY=... # optional but recommended for higher Reader limits
export PREDICT_FUN_API_KEY=... # optional, only for approved-provider integration
export FIRECRAWL_API_KEY=... # optional
rtk bun scripts/infisical/bootstrap-infisical.ts --env dev
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

Bootstrap these through the unified command:

```bash
export TURSO_PLATFORM_API_TOKEN=...
export CONTROL_PLANE_DATABASE_URL=...
export CONTROL_PLANE_MIGRATOR_DATABASE_URL=...
export TURSO_COMMUNITY_DB_WRAP_KEY=...
rtk bun scripts/infisical/bootstrap-infisical.ts --env dev
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
- `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` (also in `/services/control-plane`; must match)

Bootstrap these through the unified command:

```bash
export AUTH_UPSTREAM_JWT_SHARED_SECRET=...
export PIRATE_APP_JWT_PRIVATE_KEY=...
export PIRATE_APP_JWT_PUBLIC_KEY=...
export PRIVY_APP_SECRET=...
rtk bun scripts/infisical/bootstrap-infisical.ts --env dev
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

External registry publication is not part of the current system.

Do not provision `/services/registry-publisher` or publisher-specific secrets in
the current launch environment.

Operator env management:

- keep checked operator env templates in:
  - [scripts/infisical/.env.operator-staging.example](../../scripts/infisical/.env.operator-staging.example:1)
  - [scripts/infisical/.env.operator-production.example](../../scripts/infisical/.env.operator-production.example:1)
- source those env files through [scripts/infisical/operator-env-run.sh](../../scripts/infisical/operator-env-run.sh:1) instead of repeating inline `set -a; source ...; set +a`
- sync Cloudflare worker secrets from either the checked local env file or Infisical with [scripts/infisical/sync-wrangler-api-secrets.sh](../../scripts/infisical/sync-wrangler-api-secrets.sh:1)
- keep only true secrets in Infisical:
  - `/services/control-plane` -> `TURSO_PLATFORM_API_TOKEN`
  - `/services/control-plane` -> `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`
  - `/services/api` -> `TURSO_COMMUNITY_DB_WRAP_KEY`
  - `/services/api` -> `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` (must match `/services/control-plane`)
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

Lit-specific control-plane keys are not part of the current `pirate-v2` mainline. Do not create
`/local/lit` or any Lit-only hosted path in this project until Lit returns to the runtime.

## Not Carried Forward

Do not migrate these legacy-only secrets from `pirate/`:

- `MUSIC_PURCHASE_BASE_TREASURY_PRIVATE_KEY`
- `STORY_FEED_REGISTRAR_PRIVATE_KEY`
- `STORY_SCROBBLE_OPERATOR_PRIVATE_KEY`

Current `pirate-v2` mainline uses direct Infisical-backed Story runtime keys, not PKP/Lit usage-key flows.

## Migration Checksum Drift

The `ACCEPTED_HISTORICAL_CHECKSUMS` map in `scripts/lib/postgres-migrations.ts` exists because
the baseline migration file (`0000_control_plane_baseline_postgres.sql`) was modified after
dev and staging had already applied an earlier version of it. The databases carry the original
checksum in `schema_migrations`, but the file on disk now hashes differently.

Historical checksums recorded:

- `0000_control_plane_baseline_postgres.sql`: `74e8627d...`, `e35a9832...`,
  `b1d114fc...`, `b3159f65...`, `6f7bc3b...`, `8b61a91a...` (current file
  hashes to `bfbd53fd...`)
- `0002_control_plane_communities.sql`: `8eb1ffcb...` (applied to dev/staging; current file
  hashes differently)

**Rule: do not mutate baseline migration files after any environment has applied them.** If a
schema change is needed, it belongs in a new numbered migration.

## Environment Validation

Run `scripts/infisical/check-infisical-env.ts` before migrations and deploys to verify that the Infisical
environment matches the contract defined in `scripts/lib/infisical-env-contract.ts`:

```bash
rtk bun scripts/infisical/check-infisical-env.ts --env dev
rtk bun scripts/infisical/check-infisical-env.ts --env staging --connect
```

The `--connect` flag validates database identity, host consistency, and expected privilege shape
(migrator has DDL + DML, runtime has DML-only, roles match what the URLs claim). It is not a full
application smoke test — it checks that the secret contract is met, not that the application works.

Production absence is acceptable until production provisioning begins. The doctor will report
that the environment does not exist, which is the correct state.

## Environment Shape

The Infisical contract now has only two path families:

- `/services`
  Hosted runtime and provisioning secrets. This is the contract for `staging` and `prod`.
- `/local`
  Local-development convenience and break-glass material. This is dev-only.

Do not use `/local` as a hosted staging/production path. If a hosted break-glass store is ever
needed, it should live under a distinct ops/break-glass path with tighter access policy, not under
`/local`.

## Project Split

Treat the repo root project config as non-prod only:

- repo root `.infisical.json` -> current non-prod project (`pirate-dev-staging`)

Treat production as a separate human-only project boundary:

- `ops/prod/.infisical.json` -> prod-only project (`pirate-prod`)

Recommended usage:

```bash
# non-prod from repo root
rtk bun scripts/infisical/check-infisical-env.ts --env dev --connect
rtk bun scripts/infisical/check-infisical-env.ts --env staging --connect

# prod from human-only config dir
rtk infisical run --project-config-dir=ops/prod --env prod -- \
  rtk bun scripts/infisical/check-infisical-env.ts --env prod --connect
```

Do not point the repo root `.infisical.json` at the prod project.

`pirate-prod` is now scaffolded with the required hosted folder tree and required prod secret keys.
Those keys are intentionally seeded as `__HUMAN_SET_REQUIRED__` placeholders so the prod doctor
fails closed until a human replaces every value.

If `pirate-dev-staging` is only a rename of the existing non-prod project, the root
`.infisical.json` binding can stay as-is. If it is a different Infisical project ID, re-run
`rtk infisical init` at the repo root from a human-approved shell.

For the exact human-only prod sequence, use:

- [production-infisical-human-only-checklist.md](../runbooks/production-infisical-human-only-checklist.md)

## Bootstrap

Use `scripts/infisical/bootstrap-infisical.ts` to provision Infisical from the same contract the doctor
validates:

```bash
CONTROL_PLANE_DATABASE_URL=... CONTROL_PLANE_MIGRATOR_DATABASE_URL=... \
  rtk bun scripts/infisical/bootstrap-infisical.ts --env dev

CONTROL_PLANE_DATABASE_URL=... CONTROL_PLANE_MIGRATOR_DATABASE_URL=... \
  rtk bun scripts/infisical/bootstrap-infisical.ts --env dev --dry-run
```

The contract is the single source of truth for which secrets must exist, where, and at what
requiredness tier. Both the doctor and the unified bootstrap script read from
`scripts/lib/infisical-env-contract.ts`.

The wrapper bootstrap scripts are removed. Use only the unified script above.
