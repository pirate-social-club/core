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

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `AUTH_UPSTREAM_JWT_SHARED_SECRET` | `worker-secret` | dev | human operator | HMAC shared secret for upstream JWT verification | API worker | On compromise | No | No |
| `PIRATE_APP_JWT_PRIVATE_KEY` | `private-key` | dev | human operator | RS256 private key for signing Pirate session tokens | API worker | On compromise | No | No |
| `PIRATE_APP_JWT_PUBLIC_KEY` | `private-key` | dev | human operator | RS256 public key for verifying Pirate session tokens | API worker | On compromise | No | No |
| `PRIVY_APP_SECRET` | `api-key` | dev | human operator | Privy server-side secret for access token verification | API worker | On compromise | No | No |
| `CONTROL_PLANE_DATABASE_URL` | `database-credential` | dev | human operator | Least-privilege runtime connection string for the central Pirate Neon control-plane database | API worker | On compromise, role rotation, or planned password rotation | No | No |
| `TURSO_COMMUNITY_DB_WRAP_KEY` | `worker-secret` | dev | human operator | Envelope-encryption key for stored per-community Turso database credentials | API worker | On compromise, with controlled rewrap | No | No |
| `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION` | `tuning-knob` | dev | version control | Active envelope-encryption key version | API worker | N/A (public) | N/A | No |
| `REGISTRY_PUBLISHER_AUTH_TOKEN` | `worker-secret` | dev | human operator | Bearer token for the internal community-registry publisher boundary | API worker | On compromise | No | No |
| `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN` | `worker-secret` | dev | human operator | Bearer token for the private Turso provision operator | API worker | On compromise | No | No |
| `LIT_CHIPOTLE_OPERATOR_API_KEY` | `usage-key` | dev | human operator | Story operator PKP actions (publish-asset-version) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY` | `usage-key` | dev | human operator | Story temporary-access proof signer PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY` | `usage-key` | dev | human operator | Story settlement PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_BASE_TREASURY_API_KEY` | `usage-key` | dev | human operator | Base treasury PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_FEED_REGISTRAR_API_KEY` | `usage-key` | dev | human operator | Story feed registrar PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_SPONSOR_API_KEY` | `usage-key` | dev | human operator | Story sponsor PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_BACKEND_API_KEY` | `usage-key` | dev | human operator | Story backend signer PKP actions | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_BASE_SPONSOR_API_KEY` | `usage-key` | dev | human operator | Base verification mirror sponsor PKP actions | API worker | On compromise or suspected misuse | No | No |

Note:

- `CONTROL_PLANE_DATABASE_URL` is a secret because the Postgres connection string carries credentials. The API worker reads it as `TURSO_CONTROL_PLANE_DATABASE_URL` (a naming inconsistency that should be reconciled — see Naming section below).
- `PRIVY_APP_ID` and `PRIVY_API_URL` are not secrets — `PRIVY_APP_ID` is a public identifier, `PRIVY_API_URL` is a public endpoint.
- `JWT_BASED_AUTH_*` vars are legacy aliases for `AUTH_UPSTREAM_JWT_*`. The code falls back to the `JWT_BASED_AUTH_*` name when the `AUTH_UPSTREAM_JWT_*` name is not set. New deployments should use `AUTH_UPSTREAM_JWT_*` only.

### dev:/services/api (pirate/ carry-forward secrets)

These secrets are documented from the pirate/ v1 system. They are not yet referenced in pirate-v2 API worker code. They are listed here for migration tracking. Remove each entry once the corresponding feature is confirmed not needed in pirate-v2, or add it to the active section above once the feature is wired.

| Name | Type | Status | pirate/ Purpose |
|---|---|---|---|
| `MUSIC_WORKER_SECRET` | `worker-secret` | Not wired in pirate-v2 | Internal worker route auth |
| `STREAK_VERIFIER_PRIVATE_KEY` | `private-key` | Not wired in pirate-v2 | StreakClaimV1 verifier attestations |
| `FILEBASE_S3_ACCESS_KEY` | `s3-credential` | Not wired in pirate-v2 | S3 uploads |
| `FILEBASE_S3_SECRET_KEY` | `s3-credential` | Not wired in pirate-v2 | S3 uploads |
| `FILEBASE_S3_PROFILE_COVERS_ACCESS_KEY` | `s3-credential` | Not wired in pirate-v2 | Profile cover uploads |
| `FILEBASE_S3_PROFILE_COVERS_SECRET_KEY` | `s3-credential` | Not wired in pirate-v2 | Profile cover uploads |
| `FILEBASE_S3_ROOM_COVERS_ACCESS_KEY` | `s3-credential` | Not wired in pirate-v2 | Room cover uploads |
| `FILEBASE_S3_ROOM_COVERS_SECRET_KEY` | `s3-credential` | Not wired in pirate-v2 | Room cover uploads |
| `MUSIC_ARWEAVE_TURBO_SIGNER_PRIVATE_KEY` | `private-key` | Not wired in pirate-v2 | Arweave Turbo uploads |
| `STORY_SCROBBLE_OPERATOR_PRIVATE_KEY` | `private-key` | Not wired in pirate-v2 | Direct-key scrobble anchoring |
| `MISTRAL_API_KEY` | `api-key` | Not wired in pirate-v2 | Transcription/scoring |
| `ELEVENLABS_API_KEY` | `api-key` | Not wired in pirate-v2 | Lyrics forced alignment |
| `OPENROUTER_API_KEY` | `api-key` | Not wired in pirate-v2 | Structured-output extraction |
| `JINA_API_KEY` | `api-key` | Not wired in pirate-v2 | Authenticated Jina Reader access |
| `PREDICT_FUN_API_KEY` | `api-key` | Not wired in pirate-v2 | Predict.fun market-context search |
| `FIRECRAWL_API_KEY` | `api-key` | Not wired in pirate-v2 | Crawler fallback |
| `ALCHEMY_EVM_RPC_URLS_JSON` | `api-key` | Not wired in pirate-v2 | Multi-chain Alchemy RPC URLs |
| `ALCHEMY_ETH_MAINNET_RPC_URL` | `api-key` | Not wired in pirate-v2 | ETH mainnet NFT ownership |
| `ALCHEMY_BASE_MAINNET_RPC_URL` | `api-key` | Not wired in pirate-v2 | Base mainnet NFT ownership |
| `ALCHEMY_BASE_SEPOLIA_RPC_URL` | `api-key` | Not wired in pirate-v2 | Base Sepolia NFT ownership |
| `COMMUNITY_GATE_OPERATOR_AUTH_TOKEN` | `worker-secret` | Not wired in pirate-v2 | Community gate-rule provisioning |
| `SENTINEL_OPERATOR_AUTH_TOKEN` | `worker-secret` | Not wired in pirate-v2 | dVPN allocation |
| `GENIUS_API_KEY` | `api-key` | Not wired in pirate-v2 | Referent resolution |
| `DNS_SHARED_SECRET` | `worker-secret` | Not wired in pirate-v2 | DNS management auth |
| `ENDAOMENT_API_BEARER_TOKEN` | `api-key` | Not wired in pirate-v2 | Endaoment API calls |
| `MUSIC_TAGGED_ITEMS_RESOLVER_AUTH_TOKEN` | `worker-secret` | Not wired in pirate-v2 | Tagged-item resolver |

Note:

- `CONTROL_PLANE_DATABASE_URL` is a secret because the Postgres connection string carries credentials.
- Alchemy "RPC URLs" are modeled here as `api-key` secrets because the URLs embed the project key. If the project later splits public base URLs from a standalone Alchemy key, the base URLs can move back to version-controlled config.
- if hostnames or project identifiers are needed separately, keep those in version-controlled config or ordinary worker env.
- `SENTINEL_OPERATOR_BASE_URL` and the Sentinel operator timeout env vars are not secrets and should stay in version-controlled runtime config rather than Infisical.

## Naming Inconsistencies

These should be reconciled before the next staging deployment:

1. **`TURSO_CONTROL_PLANE_DATABASE_URL` (API worker) vs `CONTROL_PLANE_DATABASE_URL` (scripts/operator)** — same database, two names. The `TURSO_` prefix is misleading because the control-plane DB is now Neon/Postgres, not Turso. The operator examples and scripts use `CONTROL_PLANE_DATABASE_URL` which is more accurate. Recommended: rename the API worker var to `CONTROL_PLANE_DATABASE_URL`.
2. **`AUTH_UPSTREAM_JWT_*` vs `JWT_BASED_AUTH_*`** — dual naming for the same concept. `AUTH_UPSTREAM_JWT_*` is the primary name; `JWT_BASED_AUTH_*` is a legacy fallback. The `JWT_BASED_AUTH_ENABLED` flag and the `JWT_BASED_AUTH_*` fallbacks should be removed once all deployed envs use the `AUTH_UPSTREAM_JWT_*` names.
3. **`REGISTRY_PUBLISHER_URL` (code) vs `REGISTRY_PUBLISHER_BASE_URL` (json.env)** — the code reads `REGISTRY_PUBLISHER_URL`. The `BASE_URL` variant in the old json.env was never used.

### dev:/services/control-plane

Secrets consumed by private provisioning tooling or a private control-plane worker.

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `CONTROL_PLANE_MIGRATOR_DATABASE_URL` | `database-credential` | dev | human operator | Private migration and maintenance connection string for the central Pirate Neon control-plane database | private control-plane worker, CI migrations, or human-run tooling only | On compromise, role rotation, or planned password rotation | No | No |
| `TURSO_PLATFORM_API_TOKEN` | `api-key` | dev | human operator | Turso Platform API root capability for creating groups, creating databases, minting tokens, and transferring groups | private control-plane worker or human-run provisioning tooling | On compromise and after initial setup handoff | No | No |

Policy:

- `CONTROL_PLANE_MIGRATOR_DATABASE_URL` must not be present in the public API worker runtime.
- `TURSO_PLATFORM_API_TOKEN` must not be present in the public API worker runtime.
- Per-community Turso database auth tokens must not be modeled as one Infisical secret per community. They are generated from the control plane and stored encrypted in the central control-plane database.

### dev:/local/control-plane

Break-glass control-plane credentials kept outside normal service paths.

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `CONTROL_PLANE_OWNER_DATABASE_URL` | `database-credential` | dev | human operator | Break-glass owner connection string for the central Pirate Neon control-plane database | human operator only | On compromise, role rotation, or planned password rotation | No | No |

Policy:

- `CONTROL_PLANE_OWNER_DATABASE_URL` must not be present in `/services/api` or `/services/control-plane`.
- break-glass access is for exceptional recovery or role maintenance only.

### dev:/services/api (Lit usage keys)

Lit Chipotle execute-only usage keys. One key per signer family.

| Name | Type | Environment | Owner | Purpose | Runtime Consumer | Rotation Policy | Funded? | Legacy? |
|---|---|---|---|---|---|---|---|---|
| `LIT_CHIPOTLE_OPERATOR_API_KEY` | `usage-key` | dev | human operator | Story operator PKP actions (presentation/lyrics/study-set/publish-asset-version) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY` | `usage-key` | dev | human operator | Story temporary-access proof signer PKP actions for signed CDR access proofs | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY` | `usage-key` | dev | human operator | Story settlement PKP actions (`settlePurchase(...)`; later royalty-sync if adopted) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_BASE_TREASURY_API_KEY` | `usage-key` | dev | human operator | Base treasury PKP actions (donation/refund) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_FEED_REGISTRAR_API_KEY` | `usage-key` | dev | human operator | Story feed registrar PKP actions (post-story/translation) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_SPONSOR_API_KEY` | `usage-key` | dev | human operator | Story sponsor PKP actions (register-original/derivative/vault-bootstrap) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_STORY_BACKEND_API_KEY` | `usage-key` | dev | human operator | Story backend signer PKP actions (backend approvals on two-PKP router) | API worker | On compromise or suspected misuse | No | No |
| `LIT_CHIPOTLE_BASE_SPONSOR_API_KEY` | `usage-key` | dev | human operator | Base verification mirror sponsor PKP actions | API worker | On compromise or suspected misuse | No | No |

## Not Carried Forward From pirate/

These secrets existed in pirate/ and are intentionally excluded from pirate-v2:

| Name | Why excluded |
|---|---|
| `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY` | Legacy fallback for settlement signer. PKP-only in pirate-v2. |
| `MUSIC_PURCHASE_BASE_TREASURY_PRIVATE_KEY` | Legacy fallback for treasury signer. PKP-only in pirate-v2. |
| `STORY_OPERATOR_PRIVATE_KEY` | Legacy fallback for operator signer. PKP-only in pirate-v2. |
| `STORY_ACCESS_CONTROLLER_PRIVATE_KEY` | Legacy fallback for the old access-controller contract caller. In pirate-v2 this family is PKP-only and used only for signed CDR access proofs, not on-chain access-grant txs. |
| `STORY_FEED_REGISTRAR_PRIVATE_KEY` | Legacy fallback for feed registrar. PKP-only in pirate-v2. |
| `LIT_CHIPOTLE_ACCOUNT_API_KEY` | Account-scoped control-plane key for upload/sync tooling. Must not be in worker runtime. Control-plane ops only, managed outside worker secrets. |

Migration note:

- Do not wire `LIT_CHIPOTLE_ACCOUNT_API_KEY` into any runtime worker env in pirate-v2.
- If pirate-v2 later needs this key for human-run upload or sync tooling, keep it in a separate control-plane secret path such as `dev:/local/lit`, not under runtime worker paths.
- If no control-plane tooling needs it yet, do not create or migrate it preemptively.

## Secrets Not Yet Classified

These may be needed in pirate-v2 but are not yet inventoried with full metadata:

- `ENS_GATEWAY_SIGNER_PRIVATE_KEY` — if pirate-v2 carries ENS/Handshake bridge
- Any Privy or auth-related secrets beyond the current upstream-auth spec boundary
- `LIT_CHIPOTLE_ACCOUNT_API_KEY` for local human-run Lit upload or sync tooling, if and when that tooling is activated in pirate-v2
