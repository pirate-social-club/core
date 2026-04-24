# Purchase Entitlement Token

Status: active reference

Related docs:

- [overview.md](./overview.md)
- [locked-asset-delivery.md](./locked-asset-delivery.md)
- [../domain/asset.md](../domain/asset.md)
- [../domain/marketplace.md](../domain/marketplace.md)

## Purpose

This doc defines the recommended v0 entitlement token for locked Pirate assets on Story.

It covers:

- the token model for durable purchased access
- minting and burn authority
- transfer posture
- how the token maps to CDR read authorization

## Core Principle

The entitlement token is not a decorative receipt.

For locked assets, it is the canonical durable purchase-access primitive:

- settlement mints it
- the buyer holds it
- the Token Gate CDR Condition checks it

## Recommendation

Recommended v0 shape:

- one Story-side non-transferable ERC-1155-style entitlement contract
- one token class per locked asset version
- buyer balance of at least `1` means durable purchased access

This is the simplest fit for token-gated CDR reads.

## Why ERC-1155

Recommended reasons:

- one contract can represent many asset-version entitlement classes
- the condition contract can check `balanceOf(caller, tokenId) >= 1`
- Pirate does not need one ERC-721 token per purchase unless buyer-visible per-purchase provenance is a hard requirement
- repeated purchases can either remain idempotent at `1` or accumulate if product policy later wants quantity semantics

V0 posture:

- entitlement should be idempotent per buyer and asset version
- repeat purchase should not mint duplicate durable-access units by default

## Non-Goals

This contract should not be responsible for:

- price storage
- payout logic
- quote resolution
- offchain receipt metadata
- temporary share access
- CDR condition evaluation

Those belong to settlement, app records, or the CDR condition layer.

## Token Class Model

Recommended v0 storage concept:

- `token_id -> EntitlementClass`

Suggested `EntitlementClass` fields:

- `asset_version_id`
- `cdr_vault_uuid`
- `active`
- `created_at`

Suggested semantics:

- one `token_id` represents durable access to one locked asset version
- `asset_version_id` is Pirate's canonical app identifier for the locked delivery object
- `cdr_vault_uuid` is stored for operator/debug visibility and condition alignment, not as the only access key

## Minting Model

Recommended v0 authority split:

- `owner`
  - manages settlement minters
  - configures entitlement classes
- `settlement_minter`
  - mints entitlements after successful purchase settlement

Recommended operations:

- `configureEntitlementClass(...)`
- `mintEntitlement(to, tokenId)`
- `mintEntitlementBatch(...)`
- optional `revokeEntitlement(from, tokenId)` for refunds or emergency administrative invalidation

Rules:

- only configured active classes may mint
- minting to the zero address is invalid
- minting should be idempotent for an existing holder when v0 policy is one durable access unit per buyer

## Transfer Policy

Recommended v0 rule:

- non-transferable by default

Reasoning:

- Pirate v0 is modeling access entitlements, not resale rights
- transferability creates product, abuse, and legal complexity that is not required for launch
- temporary access is already handled by signed CDR proofs rather than token transfer

Implementation note:

- token transfers and operator approvals should be disabled
- burns should remain restricted to authorized admin/settlement paths

## Metadata Posture

Recommended v0 posture:

- keep onchain metadata minimal
- app records remain the main buyer-facing purchase history
- token URI, if present, should be stable and low-risk

The token does not need to expose rich purchase metadata onchain to be useful as an access primitive.

## Event Model

Suggested core events:

- `EntitlementClassConfigured(tokenId, assetVersionId, vaultUuid)`
- `SettlementMinterUpdated(minter, active)`
- `EntitlementMinted(to, tokenId, purchaseRef)`
- `EntitlementRevoked(from, tokenId, reasonCode)`

`purchaseRef` may be a hash or canonical purchase identifier if Pirate wants lightweight onchain audit linkage without turning the token into a full receipt ledger.

## Token ID Derivation

Recommended v0 rule:

- `token_id` should derive from the locked asset version identity, not from an individual purchase

Examples:

- `keccak256(asset_version_id)`
- `keccak256(publish_id)`

Avoid:

- random per-purchase token IDs for the core access primitive

That design is better suited to decorative receipts than token-gated access checks.

## Refunds And Revocation

Recommended v0 posture:

- settlement or admin may burn the entitlement on confirmed refund
- ordinary access expiry is not part of durable purchase semantics
- temporary or revocable sharing should use signed CDR proofs instead of minting transferrable or expiring tokens

This keeps durable ownership and temporary access clearly separated.

## Recommended Interface Shape

Recommended v0 behavior:

- ERC-1155-compatible balance checks
- disabled transfers
- explicit settlement-minter role
- explicit class configuration step before minting

Important read-path property:

- the CDR condition should need only token contract address and `token_id`
- no secondary `ContentRegistry` lookup should be required

## Open Questions

- Should refunds burn immediately, or first mark a class-local revocation bit before a separate burn?
- Should Pirate expose a stable token URI for wallet UX in v0, or defer wallet polish until later?
