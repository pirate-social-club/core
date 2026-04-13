# Secret Inventory

Canonical record of every secret the project needs, what kind of thing it is, where it lives, and who manages it.

This file is the single source of truth for "what secrets exist." It does not contain secret values. It describes the shape of the secret surface.

## Principles

- **Infisical stores secrets only.** API keys, private keys, and usage keys go in Infisical. Everything else is version-controlled config.
- **High-cardinality generated tenant secrets are the exception.** Per-community runtime credentials that would otherwise require one secret per community may be stored encrypted in the central control-plane database. Infisical stores the root secrets that mint and wrap those credentials, not every derived tenant token.
- **Version control stores public config.** Contract addresses, PKP addresses, action CIDs, bucket names, RPC URLs, and tuning knobs are not secrets. They live in repo config files.
- **No secret appears in more than one Infisical path.** If a secret is needed in two runtimes, both runtimes read from the same path.
- **AI environments must not have Infisical auth.** See `docs/control-plane/ai-infisical-boundary.md` (to be written for pirate-v2; policy carried from pirate/).

## Type Definitions

| Type | Secret? | Storage | Examples |
|---|---|---|---|
| `private-key` | Yes | Infisical | Contract deployer key, Arweave Turbo signer key |
| `usage-key` | Yes | Infisical | Lit Chipotle execute-only API keys |
| `api-key` | Yes | Infisical | Mistral, ElevenLabs, OpenRouter, Genius, Etherscan |
| `s3-credential` | Yes | Infisical | Filebase access/secret key pairs |
| `worker-secret` | Yes | Infisical | Worker-internal auth tokens (MUSIC_WORKER_SECRET, etc.) |
| `rpc-url` | No | Version control | Story RPC, Base RPC, fallback RPCs |
| `contract-address` | No | Version control | Deployed contract addresses |
| `pkp-address` | No | Version control | Lit PKP wallet addresses |
| `pkp-public-key` | No | Version control | Lit PKP uncompressed public keys |
| `action-cid` | No | Version control | IPFS CIDs for Lit Actions |
| `bucket-name` | No | Version control | Filebase S3 bucket names |
| `tuning-knob` | No | Version control | Gas limits, TTLs, batch sizes, fee rates |
| `subgraph-url` | No | Version control | Goldsky/TheGraph query endpoints |
| `feature-flag` | No | Version control | Optional behavior toggles |
| `encrypted-tenant-credential` | Yes | Central control-plane DB | Encrypted per-community Turso DB auth token |
| `database-credential` | Yes | Infisical | Password-bearing Postgres connection strings for the control plane |

## Inventory

### dev:/contracts/story

Secrets used by Foundry deploy scripts for Story chain contracts.

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `STORY_CONTRACT_OWNER_PRIVATE_KEY` | `private-key` | dev | human operator | Story contract deployer, role grants, emergency owner actions | Foundry deploy scripts, emergency ops | On compromise or before mainnet; migrate to multisig | Yes | No |
| `OWNER` | `contract-address` | dev | version control | Story contract owner address for deploy scripts | Foundry deploy scripts | N/A (public) | N/A | No |
| `TREASURY` | `contract-address` | dev | version control | Treasury address for contract constructor args | Foundry deploy scripts | N/A (public) | N/A | No |
| `STORY_RPC_URL` | `rpc-url` | dev | version control | Story Aeneid RPC endpoint | Foundry deploy scripts, worker | N/A (public) | N/A | No |

Note: `OWNER`, `TREASURY`, and `STORY_RPC_URL` are listed here for completeness but are not secrets. They should be version-controlled, not stored in Infisical. pirate/ put them in Infisical for deploy-script convenience. pirate-v2 should pass them as env vars or foundry config without Infisical.

### dev:/contracts/base

Secrets used by Foundry deploy scripts for Base chain contracts.

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `BASE_CONTRACT_OWNER_PRIVATE_KEY` | `private-key` | dev | human operator | Base contract deployer, role grants, emergency owner actions | Foundry deploy scripts, emergency ops | On compromise or before mainnet; migrate to multisig | Yes | No |
| `OWNER` | `contract-address` | dev | version control | Base contract owner address | Foundry deploy scripts | N/A (public) | N/A | No |
| `TREASURY` | `contract-address` | dev | version control | Treasury address for contract constructor args | Foundry deploy scripts | N/A (public) | N/A | No |
| `BASE_RPC_URL` | `rpc-url` | dev | version control | Base Sepolia RPC endpoint | Foundry deploy scripts, worker | N/A (public) | N/A | No |
| `ETHERSCAN_API_KEY` | `api-key` | dev | human operator | Contract verification on Etherscan | Foundry verify scripts | On compromise | No | No |

### dev:/services/api

Secrets consumed by the API worker at runtime.

#### Required (every deployment must have these)

The API worker cannot start without these. The sync script (`scripts/sync-wrangler-api-secrets.sh`) enforces their presence.

| Name | Type | Purpose |
|---|---|---|
| `AUTH_UPSTREAM_JWT_SHARED_SECRET` | `worker-secret` | HMAC shared secret for upstream JWT verification |
| `PIRATE_APP_JWT_PRIVATE_KEY` | `private-key` | RS256 private key for signing Pirate session tokens |
| `PIRATE_APP_JWT_PUBLIC_KEY` | `private-key` | RS256 public key for verifying Pirate session tokens |
| `PRIVY_APP_SECRET` | `api-key` | Privy server-side secret for access token verification |
| `CONTROL_PLANE_DATABASE_URL` | `database-credential` | Runtime connection string for the Neon control-plane database |

#### Conditional (only when the feature is enabled)

| Name | Type | Condition |
|---|---|---|
| `CONTROL_PLANE_AUTH_TOKEN` | `worker-secret` | When the control-plane DB requires token auth |
| `PRIVY_JWT_VERIFICATION_KEY` | `api-key` | When Privy auth is enabled |
| `REGISTRY_PUBLISHER_AUTH_TOKEN` | `worker-secret` | When `REGISTRY_PUBLISHER_URL` is configured (the API calls an external registry publisher for community creation) |
| `REDDIT_PULLPUSH_BASE_URL` | `api-key` | When Reddit onboarding is enabled |
| `REDDIT_PROFILE_CHECK_USER_AGENT` | `tuning-knob` | When Reddit profile checks are enabled |

#### Not secrets (version-controlled config)

These are read by the API worker but are public config, not secrets. They live in `wrangler.jsonc` vars or worker env, not in Infisical or Cloudflare secrets:

- `AUTH_UPSTREAM_JWT_ENABLED`, `AUTH_UPSTREAM_JWT_ISSUER`, `AUTH_UPSTREAM_JWT_AUDIENCE`
- `PIRATE_APP_JWT_ISSUER`, `PIRATE_APP_JWT_AUDIENCE`, `PIRATE_APP_JWT_TTL_SECONDS`
- `PRIVY_APP_ID`, `PRIVY_API_URL`
- `REGISTRY_PUBLISHER_URL`, `REGISTRY_PUBLISHER_TIMEOUT_MS`
- `DEV_MEMORY_STORE_ENABLED`, `ENVIRONMENT`
- `LOCAL_COMMUNITY_DB_ROOT`

### dev:/services/control-plane

Secrets consumed by private provisioning tooling, not the API worker.

| Name | Type | Purpose |
|---|---|---|
| `CONTROL_PLANE_MIGRATOR_DATABASE_URL` | `database-credential` | Private migration and maintenance connection string |
| `TURSO_PLATFORM_API_TOKEN` | `api-key` | Turso Platform API root capability |
| `TURSO_COMMUNITY_DB_WRAP_KEY` | `worker-secret` | Envelope-encryption key for per-community Turso DB credentials |
| `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` | `worker-secret` | Bearer token for the private Turso provision operator |

### dev:/services/control-plane (Lit usage keys)

Lit Chipotle execute-only usage keys. These are operator tooling keys, not API runtime secrets. They are used by human-run scripts (`scripts/lit/lit-action-smoke.mjs`, `scripts/lit/lit-probe-public-key.mjs`, deploy scripts) and will be consumed by the API worker only when PKP actions are wired into the runtime.

| Name | Type | Purpose | Wired in API worker? |
|---|---|---|---|
| `LIT_CHIPOTLE_OPERATOR_API_KEY` | `usage-key` | Story operator PKP actions | No |
| `LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY` | `usage-key` | Story temporary-access proof signer | No |
| `LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY` | `usage-key` | Story settlement PKP actions | No |
| `LIT_CHIPOTLE_BASE_TREASURY_API_KEY` | `usage-key` | Base treasury PKP actions | No |
| `LIT_CHIPOTLE_FEED_REGISTRAR_API_KEY` | `usage-key` | Story feed registrar PKP actions | No |
| `LIT_CHIPOTLE_STORY_SPONSOR_API_KEY` | `usage-key` | Story sponsor PKP actions | No |
| `LIT_CHIPOTLE_STORY_BACKEND_API_KEY` | `usage-key` | Story backend signer PKP actions | No |
| `LIT_CHIPOTLE_BASE_SPONSOR_API_KEY` | `usage-key` | Base verification mirror sponsor | No |

When a Lit key is wired into the API worker runtime, move it from `/services/control-plane` to `/services/api` and update this table.

### dev:/local/control-plane

Break-glass control-plane credentials kept outside normal service paths.

| Name | Type | Purpose |
|---|---|---|
| `CONTROL_PLANE_OWNER_DATABASE_URL` | `database-credential` | Break-glass owner connection string for role maintenance only |

### dev model

Dev is local-only. The API worker is run via `bun run dev:local` with secrets from `.dev.vars`, not from Infisical. Dev Infisical is pre-seeded for script integration testing only. Do not treat dev Infisical as the API worker's secret source.

## Live Infisical State (2026-04-13)

### /services/api

| Secret | dev | staging | prod |
|--------|-----|---------|------|
| `CONTROL_PLANE_DATABASE_URL` | YES | YES | YES |
| `AUTH_UPSTREAM_JWT_SHARED_SECRET` | — | YES | — |
| `PIRATE_APP_JWT_PRIVATE_KEY` | — | YES | — |
| `PIRATE_APP_JWT_PUBLIC_KEY` | — | YES | — |
| `PRIVY_APP_SECRET` | — | YES | — |
| `REGISTRY_PUBLISHER_AUTH_TOKEN` | YES | — | — |

### /services/control-plane

| Secret | dev | staging | prod |
|--------|-----|---------|------|
| `CONTROL_PLANE_MIGRATOR_DATABASE_URL` | YES | YES | YES |
| `TURSO_PLATFORM_API_TOKEN` | YES | YES | — |
| `TURSO_COMMUNITY_DB_WRAP_KEY` | — | YES | — |
| `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` | — | YES | — |
| `LIT_CHIPOTLE_OPERATOR_API_KEY` | YES | — | — |

### Production status

The Infisical environment slug is `prod`, not `production`. `prod:/services/api` currently contains only `CONTROL_PLANE_DATABASE_URL`, and `prod:/services/control-plane` currently contains only `CONTROL_PLANE_MIGRATOR_DATABASE_URL`. No production Cloudflare worker is deployed yet.

### Remote Cloudflare worker status

The repo currently defines a single Cloudflare worker in `pirate-api/services/api/wrangler.jsonc`: `pirate-api-core`. There is no `env.staging` or `env.production` section in that config. Direct `wrangler deployments list` and `wrangler secret list` calls confirmed that `pirate-api-core` does not exist in the current Cloudflare account yet, so the next remote step is a first deploy followed by secret sync.

## Naming (resolved)

1. ~~`TURSO_CONTROL_PLANE_DATABASE_URL` vs `CONTROL_PLANE_DATABASE_URL`~~ — **Resolved.** API worker now uses `CONTROL_PLANE_DATABASE_URL` matching the scripts/Infisical convention.
2. ~~`AUTH_UPSTREAM_JWT_*` vs `JWT_BASED_AUTH_*`~~ — **Resolved.** `JWT_BASED_AUTH_*` aliases removed. Single canonical naming: `AUTH_UPSTREAM_JWT_ENABLED`, `AUTH_UPSTREAM_JWT_SHARED_SECRET`, `AUTH_UPSTREAM_JWT_ISSUER`, `AUTH_UPSTREAM_JWT_AUDIENCE`.
3. ~~`REGISTRY_PUBLISHER_URL` vs `REGISTRY_PUBLISHER_BASE_URL`~~ — **Resolved.** `REGISTRY_PUBLISHER_BASE_URL` was a dead name only in the old `json.env`. Deleted from Infisical.
