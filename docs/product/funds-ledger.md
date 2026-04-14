# Funds Ledger

Canonical record of every address that holds value, why it holds value, and who controls it.

This is the single source of truth for funded-wallet inventory. Everything else references this, not the other way around.

Do not restate addresses from this file in wrangler.toml, release manifests, or deployment notes. Link here instead.

## Policies

- No address appears in this ledger without a documented purpose and refill path.
- No funded address is shared across chains unless explicitly justified below.
- Emergency cutoff is the first question answered for every entry, not the last.
- Balance floors are minimums, not targets. Refill when actual drops below floor, not when it reaches zero.
- PKP wallets are funded only when the PKP is the active signer. Do not pre-fund PKPs that are not yet deployed.
- Lit signer families that only produce offchain signatures and never submit transactions do not belong in this ledger.

## Ledger

### Story Aeneid (chainId 1315)

| Address | Role | Why Funded | Balance Floor | Refill Owner | Drain Policy | Emergency Cutoff |
|---|---|---|---|---|---|---|
| `STORY_OPERATOR_ADDRESS` | Story operator PKP | Gas for presentation/lyrics/study-set txs and `publishAssetVersion(...)` on locked-asset publishes | 0.05 IP | contract-owner | PKP self-drains via gas spend only; no manual drain | Revoke operator role on-chain, then sweep remaining balance from contract-owner |
| `STORY_FEED_REGISTRAR_ADDRESS` | Story feed registrar PKP | Gas for setPostStoryIpId / setPostTranslationRef txs | 0.05 IP | contract-owner | PKP self-drains via gas spend only; no manual drain | Revoke STORY_REGISTRAR_ROLE and TRANSLATION_UPDATER_ROLE on-chain |
| `STORY_SCROBBLE_OPERATOR_ADDRESS` | Story scrobble batch publisher | Gas for delegated scrobble anchoring. Signs `registerTracks(...)` then `scrobbleBatch(...)` in separate txs on `ScrobbleV1` | 0.05 IP | contract-owner | Direct-key gas spend only; no automatic drain path | Revoke operator role on `ScrobbleV1` on-chain |
| `STORY_SETTLEMENT_ADDRESS` | Story settlement PKP | Gas for `MarketplaceSettlementV1.settlePurchase(...)`; future upgrade path may also hold WIP temporarily during royalty routing | 0.1 IP | contract-owner | Native settlement gas only in v1; if later upgraded to WIP routing, sweep excess WIP to treasury on schedule | Halt settlement cron, sweep any staged funds to contract-owner, revoke operator/approval paths |
| `STORY_SPONSOR_ADDRESS` | Story sponsor PKP | Gas for sponsor-router IP registration and vault bootstrap txs | 0.1 IP | contract-owner | PKP self-drains via gas spend only; no manual drain | Remove PKP from router authorized signers on-chain |
| `STORY_BACKEND_SIGNER_ADDRESS` | Story backend signer PKP | Gas for backend-approval registration txs on the two-PKP router | 0.1 IP | contract-owner | PKP self-drains via gas spend only; no manual drain | Remove PKP from router authorized signers on-chain |
| `STORY_CONTRACT_OWNER` | Contract deployer and owner | Deploys contracts, grants roles, emergency owner actions | 0.5 IP | human operator | Never drain below floor; this is the recovery key | Transfer ownership to multisig, then drain |

### Base Sepolia (chainId 84532)

| Address | Role | Why Funded | Balance Floor | Refill Owner | Drain Policy | Emergency Cutoff |
|---|---|---|---|---|---|---|
| `BASE_SPONSOR_ADDRESS` | Base verification mirror PKP | Gas for VerificationMirrorV1 sponsor txs | 0.001 ETH | contract-owner | PKP self-drains via gas spend only; no manual drain | Update sponsor() on VerificationMirrorV1 on-chain |
| `BASE_TREASURY_ADDRESS` | Base treasury PKP | Gas for donation + refund txs; may hold USDC temporarily during refund processing | 0.005 ETH + 10 USDC | contract-owner | Sweep excess USDC to contract-owner on schedule; ETH is gas-only | Hall treasury operations cron, sweep USDC, revoke any pending approvals |
| `BASE_CONTRACT_OWNER` | Contract deployer and owner | Deploys contracts, grants roles, emergency owner actions | 0.01 ETH | human operator | Never drain below floor; this is the recovery key | Transfer ownership, then drain |

### Cross-Chain

| Address | Role | Why Funded | Balance Floor | Refill Owner | Drain Policy | Emergency Cutoff |
|---|---|---|---|---|---|---|
| `ARWEAVE_TURBO_SIGNER_ADDRESS` | Arweave Turbo upload signer | Pays for ANS-104 uploads for non-CDR artifacts such as lyrics and study-set data | per-usage estimate | human operator | Manual review; this is a direct key, not a PKP | Rotate key, drain remaining Turbo balance |

## Address Resolution

Actual addresses are not hardcoded in this file. They resolve from:

- signer-family canonical addresses: `docs/operators/signer-families.md`
- PKP control-plane addresses: `config/lit-families.json`

When those files disagree, this ledger is not authoritative on which address is correct. It is authoritative on which addresses hold value and what to do about it. Direct-key families such as `story-scrobble-operator` resolve from `docs/operators/signer-families.md` only.

## Refill Procedure

1. Check on-chain balance against floor.
2. If below floor, send from contract-owner to target address.
3. Record the refill tx hash in deployment notes.
4. Do not automate refills until balance-monitoring tooling exists.

## Emergency Procedure

1. Identify the affected entry in the ledger above.
2. Follow the emergency cutoff path for that entry.
3. Notify human operator.
4. Record the incident and the cutoff tx hash.
5. Do not restore the entry until root cause is understood.

## Definitions

- **contract-owner**: the deployer address that holds ownership roles on deployed contracts. Defined in `docs/operators/signer-families.md` per chain. Currently a direct key, intended migration target is a multisig.
- **human operator**: a person with access to the contract-owner private key or the multisig. Not an automated system.
- **PKP**: a Lit Protocol Programmable Key Pair. Cannot be extracted to a raw private key. Controlled by Lit execute groups defined in `config/lit-families.json`.
- **balance floor**: the minimum on-chain balance before a refill is required. Not a target balance.
