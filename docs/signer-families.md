# Signer Families

Canonical record of every signer identity, its on-chain authority, and its allowed contract interactions.

This is the single source of truth for signer addresses. Runtime config, deployment scripts, and on-chain grant checklists must reference this file, not duplicate addresses.

No Lit control-plane details live here. See `config/lit-families.json` for execute groups, usage keys, and action CIDs.

## Policies

- Each family has exactly one canonical signer address per environment.
- A family is either `direct-key`, `pkp`, `multisig`, or `eoa`. It cannot be two of these at once.
- No automatic fallback from PKP to direct key. If a PKP family needs a fallback, it is an explicit operational decision with a manual cutover.
- On-chain grants are tracked here. Lit execution mechanics are tracked separately.
- If a signer address appears anywhere else in the repo, it must match the address here. If it does not match, this file wins.

## Families

### story-operator

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | `0x7f969455cFe240927F1ACe4E23000685Ad224dA7` |
| Purpose | Presentation attach, karaoke attach, canonical publish pointer, lyrics write, study-set fulfill, locked-asset publish binding |
| Allowed contracts | `TrackPresentationRegistryV1`, `CanonicalLyricsRegistryV1`, `StudySetRegistryV1`, `AssetPublishCoordinatorV1` |
| Allowed methods | `setPublishPresentationAsDelegate`, `setPublishKaraokeAsDelegate`, `setCanonicalPublish`, `setLyrics`, `overwriteLyrics`, `fulfill`, `publishAssetVersion(...)` |
| Required on-chain grants | `isOperator(...)` on CanonicalLyricsRegistryV1 and StudySetRegistryV1; presentation delegate is per-publish, not a global role; `isPublishOperator(...)` on `AssetPublishCoordinatorV1` |
| Funding requirement | Yes — gas for on-chain txs. See `docs/funds-ledger.md` |
| Fallback status | Re-keyed in pirate-v2 after Lit control-plane drift on the inherited `0xA994...` operator PKP. No direct-key fallback. |

### story-access-controller

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | `0x2125952f22Ad971df5645E31a613fe42DCC42c48` |
| Purpose | Sign short-lived Story CDR access proofs for temporary shares and delegated reads |
| Allowed contracts | `PirateSignerRegistry`, `SignedAccessConditionV1` |
| Allowed methods | Offchain EIP-712 `AccessProof` signatures verified by `SignedAccessConditionV1` |
| Required on-chain grants | Must be activated in `PirateSignerRegistry`; no purchase-time `grantAccess(...)` role should exist in v2 |
| Funding requirement | No — proof signing only. This family should not be pre-funded in `docs/funds-ledger.md` |
| Fallback status | None. pirate/ had no legacy direct key for this family. |

### story-scrobble-operator

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `direct-key` |
| Canonical signer address | TBD — new direct-key for the pirate-v2 batch publisher. pirate/ scrobble addresses are not carried forward. |
| Purpose | Delegated scrobble anchoring via `registerTracks(...)` then `scrobbleBatch(...)` |
| Allowed contracts | `ScrobbleV1` |
| Allowed methods | `registerTrack(...)`, `registerTracks(...)`, `scrobble(...)`, `scrobbleBatch(...)` |
| Required on-chain grants | `isOperator(...)` on `ScrobbleV1` |
| Funding requirement | Yes — gas for on-chain txs. See `docs/funds-ledger.md` |
| Fallback status | v0: `direct-key`. PKP migration planned after the anchor worker is stable. |

Batch publish flow:

- Unregistered tracks must be registered and confirmed on-chain before their scrobbles can be included in `scrobbleBatch(...)`.
- The batch publisher groups accepted scrobbles by resolved wallet address because `ScrobbleV1.scrobbleBatch(...)` accepts one `user` per batch.
- `registerTracks(...)` and `scrobbleBatch(...)` are separate transactions in v0. Any future combined helper belongs in a new contract version, not this family definition.

### story-feed-registrar

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD — migrate from pirate/ `0x273D8e3E63B01cc8d1359033E516d1334B796083` after audit |
| Purpose | Register post-story IP IDs and translation refs on FeedV2 |
| Allowed contracts | `FeedV2` |
| Allowed methods | `setPostStoryIpId(bytes32,address)`, `setPostTranslationRef(bytes32,string)` |
| Required on-chain grants | `STORY_REGISTRAR_ROLE` and `TRANSLATION_UPDATER_ROLE` on FeedV2 |
| Funding requirement | Yes — gas for on-chain txs. See `docs/funds-ledger.md` |
| Fallback status | None. pirate/ had no legacy direct key for this family. |

### story-settlement

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | `0xfB1E0bbE209C1B75f8E365F3055bfF4b0a24702B` |
| Purpose | Execute purchase settlement on `MarketplaceSettlementV1`; future upgrade path may also cover royalty-sync flows |
| Allowed contracts | `MarketplaceSettlementV1`, `PurchaseEntitlementToken` (indirect minter relationship), WIP token (`approve`) and `RoyaltyModule` for future upgrade paths |
| Allowed methods | `settlePurchase(...)`; future upgrade path may add `approve(...)`, `payRoyaltyOnBehalf(...)`, `claimRevenueOnBehalf(...)`, `transferToVault(...)` |
| Required on-chain grants | `isSettlementOperator(...)` on `MarketplaceSettlementV1`; `PurchaseEntitlementToken.isSettlementMinter(MarketplaceSettlementV1)` must be true so settlement can mint entitlements indirectly |
| Funding requirement | Yes — gas + may hold WIP temporarily. See `docs/funds-ledger.md` |
| Fallback status | pirate/ had `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY` as legacy fallback. Must not be migrated as a fallback. Migrate as PKP-only. |

### story-sponsor

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD — migrate from pirate/ `0xd05207094f1fae08839418eae4bd279dbce6663b` after audit |
| Purpose | Sponsor-router IP registration and vault bootstrap via StorySponsorRouterV1 |
| Allowed contracts | `StorySponsorRouterV1` |
| Allowed methods | Router operations for register-original, register-derivative, vault-bootstrap |
| Required on-chain grants | Authorized signer in StorySponsorRouterV1 |
| Funding requirement | Yes — gas for sponsored txs. See `docs/funds-ledger.md` |
| Fallback status | None. Always PKP in pirate/. |

### story-backend-signer

| Field | Value |
|---|---|
| Chain | Story Aeneid (1315) |
| Signer kind | `pkp` |
| Canonical signer address | TBD — migrate from pirate/ `0xd2caab14a27496a1e1340f4caf18b1b1f001b102` after audit |
| Purpose | Backend approval for register-original, register-derivative, vault-bootstrap on the two-PKP router |
| Allowed contracts | `StorySponsorRouterV1` |
| Allowed methods | Router backend-signer operations for register-original, register-derivative, vault-bootstrap |
| Required on-chain grants | Authorized backend signer in StorySponsorRouterV1 |
| Funding requirement | Yes — gas for approval txs. See `docs/funds-ledger.md` |
| Fallback status | None. Always PKP in pirate/. |

### base-treasury

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `pkp` |
| Canonical signer address | TBD — migrate from pirate/ `0x0F15ED21B347dA747400755d5354Fd0Ae2e9AF38` after audit |
| Purpose | Base USDC donation approve + donate, refund transfers |
| Allowed contracts | Base USDC token, donation contract |
| Allowed methods | `approve(...)`, `donate(...)`, `transfer(...)` |
| Required on-chain grants | No explicit role grant required. Standard ERC-20 approval and caller semantics. |
| Funding requirement | Yes — gas + may hold USDC temporarily. See `docs/funds-ledger.md` |
| Fallback status | pirate/ had `MUSIC_PURCHASE_BASE_TREASURY_PRIVATE_KEY` as legacy fallback. Must not be migrated as a fallback. Migrate as PKP-only. |

### base-sponsor

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `pkp` |
| Canonical signer address | TBD — migrate from pirate/ `0x514d1bE37A393dE47Be255e8EaA1B3C323d87920` after audit |
| Purpose | VerificationMirrorV1 sponsor execution for Self.xyz verification |
| Allowed contracts | `VerificationMirrorV1` |
| Allowed methods | `mirror(...)` |
| Required on-chain grants | `sponsor()` on VerificationMirrorV1 must return this address |
| Funding requirement | Yes — gas for mirror txs. See `docs/funds-ledger.md` |
| Fallback status | None. Always PKP in pirate/. |

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
| Funding requirement | Yes — maintains balance floor for deployment and emergency use. See `docs/funds-ledger.md` |
| Fallback status | This is the root authority. No fallback. |

### base-contract-owner

| Field | Value |
|---|---|
| Chain | Base Sepolia (84532) |
| Signer kind | `direct-key` (migration target: `multisig`) |
| Canonical signer address | TBD — likely same address as story-contract-owner in pirate/. Audit and decide whether to split. |
| Purpose | Contract deployment, role grants, emergency owner actions |
| Allowed contracts | All deployed Base contracts |
| Allowed methods | Owner-restricted methods |
| Required on-chain grants | `owner()` on each deployed contract |
| Funding requirement | Yes — maintains balance floor for deployment and emergency use. See `docs/funds-ledger.md` |
| Fallback status | This is the root authority. No fallback. |

### arweave-turbo-signer

| Field | Value |
|---|---|
| Chain | N/A (Arweave) |
| Signer kind | `direct-key` |
| Canonical signer address | TBD — migrate from pirate/ `0xf1a70de5a579d6164db8d3c609037180137044fc` after audit |
| Purpose | Sign and pay for Arweave Turbo ANS-104 uploads for non-CDR artifacts such as lyrics and study-set data |
| Allowed contracts | Arweave Turbo upload endpoint |
| Allowed methods | ANS-104 upload |
| Required on-chain grants | None (Arweave) |
| Funding requirement | Yes — Turbo balance for uploads. See `docs/funds-ledger.md` |
| Fallback status | None. Direct key, no PKP migration planned yet. |

## Migration Notes

Addresses above are marked TBD until each one is audited against the pirate/ deployment state and confirmed correct for pirate-v2. The pirate/ addresses are included for cross-reference during migration, not as canonical values. The `story-scrobble-operator` family is a deliberate exception: pirate/ scrobble addresses are not migrated forward because pirate-v2 uses a new direct-key batch publisher on `ScrobbleV1`.

The contract-owner address `0xBAFB9D9e...` was used as both the Story deployer and the Base deployer in pirate/. It was also the legacy settlement and treasury signer before PKP migration. In pirate-v2, this address should only be the contract owner. All signing responsibilities must move to dedicated PKP families.

The `story-access-controller` family name is a carryover from pirate/. In pirate-v2 it should be interpreted as the temporary-access proof signer for CDR reads, not as a funded contract caller that writes `grantAccess(...)` rows on purchase.
