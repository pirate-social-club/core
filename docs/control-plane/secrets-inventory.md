# Secret Inventory

Canonical record of every secret the project needs, what kind of thing it is, where it lives, and who manages it.

This file is the single source of truth for "what secrets exist." It does not contain secret values. It describes the shape of the secret surface.

## Principles

- **Infisical stores secrets only.** API keys, private keys, and usage keys go in Infisical. Everything else is version-controlled config.
- **High-cardinality generated tenant secrets are the exception.** Per-community runtime credentials that would otherwise require one secret per community may be stored encrypted in the central control-plane database. Infisical stores the root secrets that mint and wrap those credentials, not every derived tenant token.
- **Version control stores public config.** Contract addresses, PKP addresses, action CIDs, bucket names, RPC URLs, and tuning knobs are not secrets. They live in repo config files.
- **The normal hosted Infisical contract has only two path families:** `/services` for hosted runtime/provisioning secrets and `/local` for local-dev-only convenience/break-glass material.
- **A small number of shared secrets are intentionally duplicated across service paths.** When the same value appears in `/services/api` and `/services/control-plane`, the doctor contract must enforce equality.
- **AI environments must not have Infisical auth.** See `docs/control-plane/ai-infisical-boundary.md`.

## Type Definitions

| Type | Secret? | Storage | Examples |
|---|---|---|---|
| `private-key` | Yes | Infisical | Contract deployer key, Arweave Turbo signer key |
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

### Story deploy signer

`STORY_CONTRACT_OWNER_PRIVATE_KEY` is no longer part of the Infisical contract.

If you still use the hot-key Story Foundry deploy path locally, treat it as an operator-local env
var only. Do not store it in hosted Infisical environments.

Current runtime model:

- owner key stays local and operator-only
- direct Story runtime signer private keys live in `/services/api`
- no Lit usage-key or PKP secret path is part of the current mainline

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

The API worker cannot start without these. The sync script (`scripts/infisical/sync-wrangler-api-secrets.sh`) enforces their presence.

| Name | Type | Purpose |
|---|---|---|
| `AUTH_UPSTREAM_JWT_SHARED_SECRET` | `worker-secret` | HMAC shared secret for upstream JWT verification |
| `PIRATE_APP_JWT_PRIVATE_KEY` | `private-key` | RS256 private key for signing Pirate session tokens |
| `PIRATE_APP_JWT_PUBLIC_KEY` | `private-key` | RS256 public key for verifying Pirate session tokens |
| `PRIVY_APP_SECRET` | `api-key` | Privy server-side secret for access token verification |
| `FILEBASE_S3_ACCESS_KEY` | `api-key` | Filebase S3 access key for community media uploads |
| `FILEBASE_S3_SECRET_KEY` | `api-key` | Filebase S3 secret key for community media uploads |
| `OPENAI_API_KEY` | `api-key` | OpenAI moderation key for `/v1/moderations` with `omni-moderation-latest`; the endpoint is free, but the OpenAI project still needs usable billing/limits |
| `OPENROUTER_API_KEY` | `api-key` | OpenRouter API key for song lyrics age-gate classification |
| `ACRCLOUD_ACCESS_KEY` | `api-key` | ACRCloud access key for song audio identification |
| `ACRCLOUD_ACCESS_SECRET` | `api-key` | ACRCloud access secret for song audio identification signing |
| `ELEVENLABS_API_KEY` | `api-key` | ElevenLabs API key for song forced alignment |
| `CONTROL_PLANE_DATABASE_URL` | `database-credential` | Runtime connection string for the Neon control-plane database |
| `PIRATE_ADMIN_TOKEN` | `worker-secret` | Production admin/operator token for namespace attach, manifest apply, and launch seed operations |
| `STORY_RUNTIME_PRIVATE_KEY` | `private-key` | Shared Story Aeneid runtime fallback signer |
| `STORY_OPERATOR_PRIVATE_KEY` | `private-key` | Story asset publish/register signer |
| `STORY_CDR_WRITER_PRIVATE_KEY` | `private-key` | Story CDR writer signer |
| `STORY_ACCESS_CONTROLLER_PRIVATE_KEY` | `private-key` | Story access proof signer |
| `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY` | `private-key` | Music purchase settlement signer |
| `PIRATE_CHECKOUT_OPERATOR_PRIVATE_KEY` | `private-key` | Base testnet checkout receiver/proof signer |
| `PIRATE_CHECKOUT_RPC_URL` | `api-key` | Checkout source-chain RPC URL when it embeds provider credentials |
| `PIRATE_CHECKOUT_SOURCE_CHAIN_ID` | `tuning-knob` | Checkout source chain id; currently carried by the secret sync contract |
| `PIRATE_CHECKOUT_USDC_TOKEN_ADDRESS` | `contract-address` | Checkout source-chain USDC address; currently carried by the secret sync contract |

#### Conditional (only when the feature is enabled)

| Name | Type | Condition |
|---|---|---|
| `CONTROL_PLANE_AUTH_TOKEN` | `worker-secret` | When the control-plane DB requires token auth |
| `PRIVY_JWT_VERIFICATION_KEY` | `api-key` | When Privy auth is enabled |
| `REDDIT_PULLPUSH_BASE_URL` | `api-key` | When Reddit onboarding is enabled |
| `REDDIT_PROFILE_CHECK_USER_AGENT` | `tuning-knob` | When Reddit profile checks are enabled |

#### Not secrets (version-controlled config)

These are read by the API worker but are public config, not secrets. They live in `wrangler.jsonc` vars or worker env, not in Infisical or Cloudflare secrets:

- `AUTH_UPSTREAM_JWT_ENABLED`, `AUTH_UPSTREAM_JWT_ISSUER`, `AUTH_UPSTREAM_JWT_AUDIENCE`
- `PIRATE_APP_JWT_ISSUER`, `PIRATE_APP_JWT_AUDIENCE`, `PIRATE_APP_JWT_TTL_SECONDS`
- `PRIVY_APP_ID`, `PRIVY_API_URL`
- `VERY_APP_ID`, `VERY_API_URL`, `VERY_VERIFY_URL`
- `REGISTRY_PUBLISHER_URL`, `REGISTRY_PUBLISHER_TIMEOUT_MS`
- `DEV_MEMORY_STORE_ENABLED`, `ENVIRONMENT`
- `LOCAL_COMMUNITY_DB_ROOT`
- `FILEBASE_MEDIA_BUCKET`, `FILEBASE_S3_ENDPOINT`, `FILEBASE_S3_REGION`
- `OPENAI_MODERATION_BASE_URL`, `OPENAI_MODERATION_MODEL`, `OPENAI_MODERATION_TIMEOUT_MS`
- `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_MS`
- `ACRCLOUD_HOST`, `ACRCLOUD_IDENTIFY_PATH`, `ACRCLOUD_TIMEOUT_MS`
- `ELEVENLABS_FORCE_ALIGNMENT_URL`, `ELEVENLABS_TIMEOUT_MS`

### dev:/services/control-plane

Secrets consumed by private provisioning tooling, not the API worker.

| Name | Type | Purpose |
|---|---|---|
| `CONTROL_PLANE_MIGRATOR_DATABASE_URL` | `database-credential` | Private migration and maintenance connection string |
| `TURSO_PLATFORM_API_TOKEN` | `api-key` | Turso Platform API root capability |
| `TURSO_COMMUNITY_DB_WRAP_KEY` | `worker-secret` | Envelope-encryption key for per-community Turso DB credentials |
| `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` | `worker-secret` | Bearer token for the private Turso provision operator |

### dev:/services/bot-runner

Secrets consumed by hosted or local bot runner processes. The bot runner is not the API worker
and should not receive the full `/services/api` secret surface.

| Name | Type | Purpose |
|---|---|---|
| `BOT_WALLET_MASTER_SECRET` | `worker-secret` | Root key material for deterministic per-bot EOA wallet derivation |
| `BOT_XMTP_DB_ENCRYPTION_SECRET` | `worker-secret` | Root key material for deterministic per-bot XMTP local database encryption keys |
| `PIRATE_ADMIN_TOKEN` | `worker-secret` | Temporary v1 admin capability for bot provisioning and bot token minting until a narrower bot-runner token exists |
| `OPENROUTER_API_KEY` | `api-key` | LLM generation key for bot actions |

Do not store one private key per bot in Infisical. Bot wallet keys are high-cardinality generated
tenant credentials: derive them from `BOT_WALLET_MASTER_SECRET` with handle-scoped HKDF labels,
store only the derived address in the control-plane DB, and keep private keys in memory only.

### dev:/local/control-plane

Break-glass control-plane credentials kept outside normal service paths.

| Name | Type | Purpose |
|---|---|---|
| `CONTROL_PLANE_OWNER_DATABASE_URL` | `database-credential` | Break-glass owner connection string for role maintenance only |

### dev model

Dev is local-only. The API worker is run via `bun run dev:local` with secrets from `.dev.vars`, not from Infisical. Dev Infisical is pre-seeded for script integration testing only. Do not treat dev Infisical as the API worker's secret source.

### Hosted model

Hosted environments use `/services` only.

- `staging` and `prod` should not use `/local`
- `/services/bot-runner` is optional until a bot runner is deployed; when present, it is a
  separate least-privilege secret boundary for bot automation
- `CONTROL_PLANE_OWNER_DATABASE_URL` may still exist operationally for hosted databases, but it is break-glass material and should not be part of the normal hosted Infisical contract
- Lit/PKP secret paths are out of the current hosted mainline
- `REGISTRY_PUBLISHER_AUTH_TOKEN` is out of the hosted mainline until `REGISTRY_PUBLISHER_URL` is configured deliberately

## Live State

Live Infisical contents drift quickly. Do not treat this file as a live inventory snapshot.

Use these instead:

- `rtk bun scripts/infisical/check-infisical-env.ts --env <env>`
- `rtk bun scripts/infisical/check-infisical-env.ts --env <env> --connect`
- `rtk bun scripts/infisical/check-infisical-env.ts --env prod --profile commerce --connect`
- the shared contract in `scripts/lib/infisical-env-contract.ts`

The doctor fails on undeclared live hosted folders/secrets by default. Use `--allow-extra` only
for one-off inventory, not production readiness gates.

The current hosted environment slug is `prod`, not `production`.

## Naming (resolved)

1. ~~`TURSO_CONTROL_PLANE_DATABASE_URL` vs `CONTROL_PLANE_DATABASE_URL`~~ — **Resolved.** API worker now uses `CONTROL_PLANE_DATABASE_URL` matching the scripts/Infisical convention.
2. ~~`AUTH_UPSTREAM_JWT_*` vs `JWT_BASED_AUTH_*`~~ — **Resolved.** `JWT_BASED_AUTH_*` aliases removed. Single canonical naming: `AUTH_UPSTREAM_JWT_ENABLED`, `AUTH_UPSTREAM_JWT_SHARED_SECRET`, `AUTH_UPSTREAM_JWT_ISSUER`, `AUTH_UPSTREAM_JWT_AUDIENCE`.
3. ~~`REGISTRY_PUBLISHER_URL` vs `REGISTRY_PUBLISHER_BASE_URL`~~ — **Resolved.** `REGISTRY_PUBLISHER_BASE_URL` was a dead name only in the old `json.env`. Deleted from Infisical.
