# Scripts

This directory contains shared operational tooling for the core repo.

Top-level `scripts/` should stay limited to human-facing entrypoints. Shared helpers belong under `scripts/lib/`. Domain-specific tool groups can keep their own subdirectories, such as `scripts/lit/`.

## Current Layout

- `apply-postgres-migrations.ts`
  Applies PostgreSQL control-plane migrations from `db/control-plane/migrations`, including the fresh-database baseline snapshot for new Neon targets.
- `inventory-control-plane.ts`
  Runs a read-only control-plane inventory against the configured database URL and flags likely fixture contamination versus live Turso-backed state.
- `harden-control-plane-postgres.ts`
  Applies owner-only Neon hardening: pgAudit, runtime `schema_migrations` read grants, and FORCE RLS policies on crown-jewel tables. Requires an explicit owner-capable database URL; it does not fall back to the runtime URL. Supports `--allow-missing-pgaudit` so grants and RLS can still be applied when Neon blocks the extension.
- `apply-sqlite-migrations.sh`
  Applies SQLite/libSQL community-template migrations from `db/community-template/migrations`.
- `bootstrap-community-db.sh`
  Bootstraps a local community database from the template schema.
- `bootstrap-community-slice.ts`
  Provisions the control-plane records plus the local community database for a local slice.
- `bootstrap-infisical-api-runtime.sh`
  Writes API runtime secrets such as JWT signing material, Privy secret material, and private operator bearer tokens into `/services/api` for a chosen Infisical env.
- `turso-control-plane.ts`
  Private operator CLI for Turso-backed community provisioning operations. Supports `provision-community`, `rotate-community-token`, and `doctor`. `doctor` verifies binding/credential invariants plus remote `schema_migrations` state. Source operator-only secrets from a separate local env file such as `scripts/.env.operator-staging`, not from the public API runtime env. Keep those local files untracked and use the checked-in `*.example` templates as the source of truth.
- `enforce-turso-delete-protection.ts`
  Enables Turso delete protection on existing community groups and databases in the configured org.
- `cleanup-orphaned-turso-resources.ts`
  Deletes orphaned Turso groups and databases after confirming they have no control-plane binding rows.
- `turso-control-plane-operator.ts`
  Private HTTP operator for Turso-backed community provisioning. Serves authenticated internal routes for `provision`, `rotate-token`, and `doctor` so the public API worker can provision through a private boundary without holding `TURSO_PLATFORM_API_TOKEN`.
- `reconcile-community-provisioning-state.ts`
  Promotes published-but-error communities back to `provisioning_state=active` when their binding and credential shape is still valid.
- `archive-tableland-community.ts`
  Updates published Tableland community rows to a new status such as `archived`.
- `operator-env-run.sh`
  Sources an operator env file, validates the required env contract for a named profile, and executes the target command. Use this instead of repeating `set -a; source ...; set +a` in runbooks.
- `sync-wrangler-api-secrets.sh`
  Pushes the current API runtime secret surface into the default Wrangler worker from `pirate-api/services/api/wrangler.jsonc`. Use this after sourcing a local env file or inside `rtk infisical run`.
- `bootstrap-infinity-existing-user.sh`
  Seeds a deterministic existing-user fixture plus a local Infinity community.
- `seed-control-plane-fixtures.ts`
  Seeds deterministic control-plane fixture users and namespace verification state. Refuses Neon-hosted targets unless `--allow-production` is passed explicitly.
- `split-control-plane-roles.ts`
  Splits control-plane access into runtime and migrator roles, with optional Infisical writes. Supports `--skip-infisical` for dry bootstrap and `--allow-missing-pgaudit` to continue when Neon blocks the extension.
- `spaces-sign-digest.ts`
  Signs a namespace digest for Spaces verification flows.
- `spaces-verifier.ts`
  Local HTTP verifier sidecar for Spaces verification.
- `mint-test-jwt.mjs`
  Mints a local test JWT for auth and onboarding flows.
- `check-lit-config.mjs`
  Validates Lit control-plane config and delivery manifests.

## Subdirectories

- `lib/`
  Shared helpers used by the top-level scripts.
- `lit/`
  Lit-specific operational scripts and its own README.
- `spaces-verifier-native/`
  Native verifier binary source.
- `vendor/`
  Vendored third-party source. Keep this isolated from normal entrypoints.

## Hygiene Rules

- Do not add benchmark data, one-off notes, or historical artifacts to the top level unless they are active runtime inputs.
- If a script is documented as runnable, keep the file present and verified.
- If a command is only planned, document it as planned in `docs/`, not as an existing script.
- Native build outputs such as `scripts/spaces-verifier-native/target/` are local cache, not repo content. Clean them when disk usage spikes, or set a separate `CARGO_TARGET_DIR` if you need to keep repeated Rust builds off the workspace tree.

## Operator Launch Example

Start the private Turso provision operator with the checked operator env template:

```bash
rtk ./scripts/operator-env-run.sh --env-file scripts/.env.operator-staging --profile turso-operator-server -- \
  rtk bun scripts/turso-control-plane-operator.ts
```

Sync the remote API worker secrets from Infisical:

```bash
rtk infisical run --env staging --path /services/api -- \
  rtk ./scripts/sync-wrangler-api-secrets.sh
```
