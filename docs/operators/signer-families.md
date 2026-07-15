# Signer Families

Architecture and role-design reference for signer families. Some addresses below describe the retired Lit/PKP design and are retained for migration history; they are not runtime configuration.

The canonical hosted-runtime address and funding inventory is `config/runtime-wallet-registry.json`. Runtime secrets live in Infisical and must carry matching `*_ADDRESS` guards.

No Lit control-plane details live here. See `config/lit-families.json` for execute groups, usage keys, and action CIDs.

## Policies

- Each family has exactly one canonical signer address per environment.
- A deployed family has one active signing backend: `direct-key`, `pkp`, or `multisig`. Historical PKP identities are not runtime fallbacks.
- Hosted runtime backend and address claims must agree with `config/runtime-wallet-registry.json` and the API signer resolver. `config/lit-families.json` is historical inventory, not evidence that hosted execution still uses PKP.
- On-chain grants are tracked here. Lit execution mechanics are tracked separately.
- Hosted runtime addresses must match `config/runtime-wallet-registry.json`; deployment manifests remain evidence of their specific deployment and grants.

## Families

### story-operator

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` in the hosted API; retired PKP metadata remains in `config/lit-families.json` |
| Canonical signer address | Per environment in `config/runtime-wallet-registry.json` (`story.wallets.operator`) |
| Purpose | Story IP registration plus presentation attach, karaoke attach, canonical publish pointer, lyrics write, study-set fulfill, and locked-asset publish binding |
| Allowed contracts | Story Protocol registration contracts/SPG NFT, `TrackPresentationRegistryV1`, `CanonicalLyricsRegistryV1`, `StudySetRegistryV1`, `AssetPublishCoordinatorV1` |
| Allowed methods | Story SDK original/derivative registration, `setPublishPresentationAsDelegate`, `setPublishKaraokeAsDelegate`, `setCanonicalPublish`, `setLyrics`, `overwriteLyrics`, `fulfill`, `publishAssetVersion(...)` |
| Required on-chain grants | `isOperator(...)` on CanonicalLyricsRegistryV1 and StudySetRegistryV1; presentation delegate is per-publish, not a global role; `isPublishOperator(...)` on `AssetPublishCoordinatorV1` |
| Funding requirement | Yes — gas for on-chain txs. See `docs/product/funds-ledger.md` |
| Fallback status | Direct-key is the current hosted backend. There is no automatic fallback to the retired PKP path. |

### story-access-controller

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` in the hosted API; offchain signing only |
| Canonical signer address | Per environment in `config/runtime-wallet-registry.json` (`story.wallets.accessController`) |
| Purpose | Sign short-lived Story CDR access proofs for temporary shares and delegated reads |
| Allowed contracts | `PirateSignerRegistry`, `SignedAccessConditionV1` |
| Allowed methods | Offchain EIP-712 `AccessProof` signatures verified by `SignedAccessConditionV1` |
| Required on-chain grants | Must be activated in `PirateSignerRegistry`; no purchase-time `grantAccess(...)` role should exist in v2 |
| Funding requirement | No — proof signing only. This family should not be pre-funded in `docs/product/funds-ledger.md` |
| Fallback status | Direct-key is the current hosted backend. The retired PKP is not an automatic fallback. |

### story-cdr-writer

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` in the hosted API |
| Canonical signer address | Per environment in `config/runtime-wallet-registry.json` (`story.wallets.cdrWriter`) |
| Purpose | Allocate Story CDR vaults and write encrypted song data keys during locked-song publish |
| Allowed contracts | Story CDR (`0xcccccc0000000000000000000000000000000005`) |
| Allowed methods | `allocate(...)`, `write(...)` |
| Required on-chain grants | None beyond owning/funding the signer for CDR fee-bearing transactions |
| Funding requirement | Yes — gas plus CDR allocate/write fees. See `docs/product/funds-ledger.md` |
| Fallback status | Direct-key is the current hosted backend. The retired PKP is not an automatic fallback. |

### story-entitlement-class-configurer

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` in the hosted API |
| Canonical signer address | Per environment in `config/runtime-wallet-registry.json` (`story.wallets.entitlementConfigurer`) |
| Purpose | Configure entitlement classes required by Story publish flows |
| Allowed contracts | Configured purchase-entitlement class-configurer contract |
| Allowed methods | `configureEntitlementClass(...)` used by `story-publish-service.ts` |
| Required on-chain grants | Contract-specific class-configurer authorization |
| Funding requirement | Yes — gas for configuration transactions. See `docs/product/funds-ledger.md` |
| Fallback status | No automatic fallback. |

### story-feed-registrar

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD - confirm `0x273D8e3E63B01cc8d1359033E516d1334B796083` after audit |
| Purpose | Register post-story IP IDs and translation refs on FeedV2 |
| Allowed contracts | `FeedV2` |
| Allowed methods | `setPostStoryIpId(bytes32,address)`, `setPostTranslationRef(bytes32,string)` |
| Required on-chain grants | `STORY_REGISTRAR_ROLE` and `TRANSLATION_UPDATER_ROLE` on FeedV2 |
| Funding requirement | Yes — gas for on-chain txs. See `docs/product/funds-ledger.md` |
| Fallback status | None. No direct-key fallback exists for this family. |

### story-settlement

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` in the hosted API; retired PKP metadata remains in `config/lit-families.json` |
| Canonical signer address | Per environment in `config/runtime-wallet-registry.json` (`story.wallets.settlement`) |
| Purpose | Pay purchase royalties, transfer descendant royalty to parent vaults, and mint purchase entitlements |
| Allowed contracts | Story `RoyaltyModule`, WIP token integration used by the Story SDK, and `PurchaseEntitlementToken` |
| Allowed methods | `payRoyaltyOnBehalf(...)`, `transferToVault(...)`, `mintEntitlement(...)`; the historical PKP action describes `settlePurchase(...)` |
| Required on-chain grants | The settlement signer must be an authorized direct minter on `PurchaseEntitlementToken`; royalty calls follow Story Protocol caller and token-balance rules |
| Funding requirement | Yes — gas + may hold WIP temporarily. See `docs/product/funds-ledger.md` |
| Fallback status | Direct-key is the current hosted backend. The retired PKP is not an automatic fallback. |

### story-sponsor

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD - confirm `0xd05207094f1fae08839418eae4bd279dbce6663b` after audit |
| Purpose | Sponsor-router IP registration and vault bootstrap via StorySponsorRouterV1 |
| Allowed contracts | `StorySponsorRouterV1` |
| Allowed methods | Router operations for register-original, register-derivative, vault-bootstrap |
| Required on-chain grants | Authorized signer in StorySponsorRouterV1 |
| Funding requirement | Yes — gas for sponsored txs. See `docs/product/funds-ledger.md` |
| Fallback status | None. Always PKP. |

### story-backend-signer

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD - confirm `0xd2caab14a27496a1e1340f4caf18b1b1f001b102` after audit |
| Purpose | Backend approval for register-original, register-derivative, vault-bootstrap on the two-PKP router |
| Allowed contracts | `StorySponsorRouterV1` |
| Allowed methods | Router backend-signer operations for register-original, register-derivative, vault-bootstrap |
| Required on-chain grants | Authorized backend signer in StorySponsorRouterV1 |
| Funding requirement | Yes — gas for approval txs. See `docs/product/funds-ledger.md` |
| Fallback status | None. Always PKP. |

### base-treasury

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `pkp` |
| Canonical signer address | TBD - confirm `0x0F15ED21B347dA747400755d5354Fd0Ae2e9AF38` after audit |
| Purpose | Base USDC donation approve + donate, refund transfers |
| Allowed contracts | Base USDC token, donation contract |
| Allowed methods | `approve(...)`, `donate(...)`, `transfer(...)` |
| Required on-chain grants | No explicit role grant required. Standard ERC-20 approval and caller semantics. |
| Funding requirement | Yes — gas + may hold USDC temporarily. See `docs/product/funds-ledger.md` |
| Fallback status | Do not configure a direct-key fallback. Migrate as PKP-only. |

### base-sponsor

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `pkp` |
| Canonical signer address | TBD - confirm `0x514d1bE37A393dE47Be255e8EaA1B3C323d87920` after audit |
| Purpose | VerificationMirrorV1 sponsor execution for Self.xyz verification |
| Allowed contracts | `VerificationMirrorV1` |
| Allowed methods | `mirror(...)` |
| Required on-chain grants | `sponsor()` on VerificationMirrorV1 must return this address |
| Funding requirement | Yes — gas for mirror txs. See `docs/product/funds-ledger.md` |
| Fallback status | None. Always PKP. |

### story-contract-owner

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` (migration target: `multisig`) |
| Canonical signer address | `0xBAFB9D9e48c39b16895e2F11E40eE656a4b31f87` |
| Purpose | Contract deployment, role grants, emergency owner actions |
| Allowed contracts | All deployed Story contracts |
| Allowed methods | Owner-restricted methods: `setOperator`, `setAccessController`, `grantRole`, `transferOwnership` |
| Required on-chain grants | `owner()` on each deployed contract |
| Funding requirement | Yes — maintains balance floor for deployment and emergency use. See `docs/product/funds-ledger.md` |
| Fallback status | This is the root authority. No fallback. |

### base-contract-owner

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `direct-key` (migration target: `multisig`) |
| Canonical signer address | TBD - audit and decide whether to match `story-contract-owner` or split. |
| Purpose | Contract deployment, role grants, emergency owner actions |
| Allowed contracts | All deployed Base contracts |
| Allowed methods | Owner-restricted methods |
| Required on-chain grants | `owner()` on each deployed contract |
| Funding requirement | Yes — maintains balance floor for deployment and emergency use. See `docs/product/funds-ledger.md` |
| Fallback status | This is the root authority. No fallback. |

### arweave-turbo-signer

| Field | Value |
|---|---|
| Chain | N/A (Arweave) |
| Signer kind | `direct-key` |
| Canonical signer address | TBD - confirm `0xf1a70de5a579d6164db8d3c609037180137044fc` after audit |
| Purpose | Sign and pay for Arweave Turbo ANS-104 uploads for non-CDR artifacts such as lyrics and study-set data |
| Allowed contracts | Arweave Turbo upload endpoint |
| Allowed methods | ANS-104 upload |
| Required on-chain grants | None (Arweave) |
| Funding requirement | Yes — Turbo balance for uploads. See `docs/product/funds-ledger.md` |
| Fallback status | None. Direct key, no PKP migration planned yet. |

## Audit Notes

Addresses marked TBD must be audited before use.

The executable hosted inventory, including serialization and journal coverage, is
`docs/operators/runtime-chain-writer-inventory.md`. It must be updated whenever a
new signing call site is added.

The contract-owner address `0xBAFB9D9e...` should only be the contract owner. Signing responsibilities belong to the dedicated signer families above.

The `story-access-controller` family signs temporary-access proofs for CDR reads. It is not a funded contract caller and must not write `grantAccess(...)` rows on purchase.
