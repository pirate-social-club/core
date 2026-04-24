# Locked Asset Delivery

Status: active reference

Related docs:

- [overview.md](./overview.md)
- [../domain/asset.md](../domain/asset.md)
- [../domain/marketplace.md](../domain/marketplace.md)
- [scrobble-v1.md](./scrobble-v1.md)

## Purpose

This doc defines the recommended v0 delivery architecture for locked Pirate assets on Story.

It covers:

- why `pirate/` ended up with a split delivery model
- how full Story CDR changes the design space
- the recommended access-control model for purchases and shares
- which old contracts should and should not carry forward

## Core Principle

If Pirate commits to Story CDR for locked assets, CDR should become the actual delivery primitive rather than a sidecar.

That means:

- `public` assets use ordinary delivery
- `locked` assets use CDR
- Pirate should not keep a second parallel key-delivery system for the same locked payloads

## Non-Goals

This doc does not define:

- exact Solidity ABIs
- exact storage-provider implementation
- exact Story protocol fees
- exact NFT metadata format for entitlement tokens

## Background: What `pirate/` Actually Did

The old stack had three distinct layers:

1. onchain entitlement state via `ContentRegistry`
2. CDR condition contracts via `ContentRegistryCdrConditionV1` and `SignedPurchaseCondition`
3. actual key delivery through buyer-specific ECIES envelopes and Arweave manifests

This meant `pirate/` had CDR-compatible contracts without making CDR the real product delivery path.

Consequences:

- purchase entitlement and key delivery were separate systems
- buyers needed registered P-256 content keys
- the API had to generate buyer-specific envelopes
- async workers had to finish key-access jobs after purchase
- the manifest layer became coupled to `buyer_envelope` semantics

The result was architectural duplication rather than a single locked-asset primitive.

## Why Full CDR Is Better Now

The current Story CDR SDK supports the missing piece cleanly:

- allocate a vault with explicit write and read conditions
- encrypt the asset payload or asset key to the DKG public key
- store encrypted file bytes in external storage
- recover the decryption material through the protocol when the read condition passes

This changes the access credential model:

- old buyer-envelope path: access depended on a buyer-managed P-256 key
- CDR path: access depends on satisfying the vault's onchain read condition

For Pirate, that is the better fit.

Pirate already wants:

- Story-native locked delivery
- canonical onchain purchase execution
- narrow contract surfaces

CDR aligns with those goals better than per-buyer envelope generation.

## Recommended V0 Rule

For `access_mode = locked`:

- the full payload should be encrypted once
- the encrypted payload should live in external storage
- the CDR vault should hold the recovery payload and enforce read access
- Pirate should not issue buyer-specific key envelopes for the same asset

For `access_mode = public`:

- Pirate should not use CDR by default

## Delivery Model

Recommended v0 locked-asset flow:

1. Pirate prepares the locked asset payload.
2. Pirate encrypts the payload with a symmetric content key.
3. Pirate uploads the encrypted blob to external storage.
4. Pirate creates a CDR vault for the asset version.
5. Pirate stores recovery payload data behind the vault.
6. Pirate sets Story-side write and read conditions at vault allocation.
7. Purchase execution grants the buyer the right to satisfy the read condition.
8. The buyer calls the CDR read path and recovers the payload needed to decrypt the asset.

Publish-time integration note:

- the app-side publish pipeline should call the CDR SDK to allocate and write the vault during publication
- the Asset Publish Coordinator should record the resulting vault UUID, condition metadata, and asset-version linkage
- v0 should not try to make the onchain publish coordinator itself perform CDR SDK operations

Recommended recovery payload contents:

- storage reference
- content key
- payload integrity metadata
- optional version metadata

The exact payload format may evolve, but the important property is that the vault governs recovery of the decryption material rather than Pirate generating buyer-specific envelopes.

## Asset-Type Payload Expectations

The locked-delivery architecture is the same for every supported locked asset type.

That means the publish and purchase path stays the same:

- prepare payload
- encrypt payload
- store encrypted payload externally
- store recovery material in CDR
- gate reads with the entitlement condition

What changes by asset type is only the payload bytes and the client behavior after decryption.

Recommended v0 expectations:

- locked song
  - encrypted audio payload
- locked text
  - encrypted full-text payload, with the public post acting as teaser or excerpt rather than the canonical paid body
- locked single image
  - encrypted full-resolution image payload
- locked video
  - encrypted video payload
  - v0 may use a download-then-play client path rather than entitlement-aware streaming
  - v0 should not require a separate preview-clip asset for locked video; metadata and poster-style presentation are enough

Deferred:

- multi-image gallery sale is not a required v0 commerce surface
- if Pirate later supports gallery sale, the payload may be a packaged blob or an encrypted manifest pointing to multiple encrypted media objects
- replay still uses the same locked entitlement architecture, but playback UX may need more explicit product design than ordinary premium video

## Purchase Access Model

### Recommendation

Purchased access should be token-gated, not `ContentRegistry`-gated.

Recommended shape:

- purchase settlement mints or transfers a buyer-visible entitlement token
- the CDR read condition checks token ownership or balance
- the entitlement token becomes the canonical bought-access state

This makes the old optional receipt concept materially more important for locked assets. If Pirate adopts token-gated CDR reads, the entitlement token is no longer just decorative buyer UX. It becomes the access primitive.

### Why Token Gate Beats `ContentRegistry`

If Pirate uses `ContentRegistry` plus CDR, it recreates dual state:

- entitlement state in `ContentRegistry`
- access enforcement in the CDR vault condition

That is better than the old buyer-envelope lane, but still heavier than necessary.

Token-gated purchase access is cleaner because:

- the receipt and the access grant are the same object
- there is no separate grant table
- there is no purchase-access job whose only purpose is to call `grantAccess(...)`
- the buyer can prove access directly from wallet state
- transferability and revocation policy become explicit token-design questions rather than hidden registry behavior

### Token Design Notes

Recommended v0 posture:

- one non-transferable ERC-1155-style entitlement class per locked asset version
- non-transferable by default unless product policy explicitly wants resale or gifting
- buyer balance of at least `1` means durable purchased access

The exact token standard may be ERC-721 or ERC-1155. That is an ABI/design choice, not the main architectural decision.

The important choice is:

- entitlement token present = purchased access
- no separate `ContentRegistry` grant row required

## Temporary Access And Shares

Temporary or revocable access should use signed proofs rather than token transfers.

Recommended shape:

- Pirate API issues a short-lived signed access proof
- the CDR read condition verifies caller, namespace, scope, expiry, and signature
- scopes such as `asset.owner` and `asset.share` remain explicit

This is the right place for the old `SignedPurchaseCondition` pattern.

Recommended v0 split:

- durable purchases: token-gated
- temporary shares or delegated reads: signed proof

Pirate should avoid using signed proofs for ordinary purchased ownership when a durable onchain entitlement exists.

## Namespace And Versioning

The old signed condition used a namespace derived from track identity alone.

That is too coarse for Pirate if vault rotation or asset-version rotation matters.

Recommended v0 rule:

- namespace should be per asset version, not just per logical track

Example inputs:

- `asset_id`
- `asset_version_id`
- or a stable Pirate `publish_id` / `release_id` equivalent

Reasoning:

- vault rotation should not silently widen access to older or newer versions
- audit trails should map cleanly to one delivery object
- signed temporary access should bind to the concrete locked artifact the buyer is reading

## Storage Model

Recommended v0 posture:

- encrypted blob in external storage
- CDR vault stores recovery payload
- Pirate metadata points to the storage reference and Story delivery state

This preserves the main operational benefits Pirate already wanted:

- large media remains offchain
- publication stays asynchronous
- feed rendering is not blocked on Story delivery

## Recommended V0 Contract Set

If Pirate goes full CDR for locked assets, the sensible locked-delivery contract inventory is:

Current concrete contract names implemented in `contracts/`:

- `AssetPublishCoordinatorV1`
- `MarketplaceSettlementV1`
- `PurchaseEntitlementToken`
- `TokenGateCondition`
- `PirateSignerRegistry`
- `SignedAccessConditionV1`

### 1. Asset Publish Coordinator

Role:

- register locked asset version metadata
- bind an asset version to its CDR vault UUID
- store namespace / delivery metadata references
- coordinate publish lifecycle for Story-facing locked assets

Current v1 implementation name: `AssetPublishCoordinatorV1`.

This is the spiritual successor to `PublishCoordinatorV1`, but without assuming buyer-envelope delivery.

### 2. Marketplace Settlement Contract

Role:

- execute purchase settlement on Story
- route payout according to resolved policy
- mint or trigger the buyer entitlement token

Current v1 implementation name: `MarketplaceSettlementV1`.

This remains required regardless of the exact CDR condition design.

### 3. Purchase Entitlement Token

Role:

- represent durable bought access onchain
- serve as the canonical purchased-access primitive for locked assets

Current v1 implementation name: `PurchaseEntitlementToken`.

If Pirate chooses token-gated CDR reads, this contract is part of the core locked-delivery stack rather than an optional UX receipt.

### 4. Token Gate CDR Condition

Role:

- authorize CDR reads when the caller holds the required entitlement token

Recommended condition inputs:

- entitlement token address
- token identifier or asset entitlement class
- optional minimum balance

Current v1 implementation name: `TokenGateCondition`.

### 5. Signed Access Condition

Role:

- authorize short-lived CDR reads for temporary shares, delegated access, or fast revocation flows

Current v1 implementation names: `PirateSignerRegistry` and `SignedAccessConditionV1`.

This is the reusable successor to `SignedPurchaseCondition`.

## Contracts Not Carried Forward

Under the recommended full-CDR design, Pirate should not carry forward these contracts as core locked-delivery primitives:

- `ContentRegistry`
- `ContentRegistryCdrConditionV1`

Reason:

- they encode a separate onchain access ledger that is unnecessary when the entitlement token already serves as the access primitive

This does not mean the old contracts were wrong. It means they solved a different transitional architecture where CDR was present but not fully adopted for delivery.

## Signer And Funding Implications

This design changes signer responsibilities.

Likely effects:

- the old Story access-controller signer becomes smaller or disappears for ordinary purchases
- purchase completion should not require a follow-up `grantAccess(...)` job when entitlement minting already happened during settlement
- the Arweave Turbo signer becomes less central for locked-audio delivery because CDR replaces buyer-envelope manifest logic

Operationally, Pirate should revisit:

- `story-access-controller`
- `story-settlement`
- any Arweave/Turbo signer families previously justified by buyer-envelope manifest publication

The signer and funding inventories should treat this delivery decision as authoritative.

## Comparison Summary

### Buyer Envelope

- buyer-specific key ciphertexts
- buyer-managed P-256 key registration
- separate async key-delivery subsystem
- manifest semantics tied to envelope policy
- harder support for shares, multi-device access, and future rotation

### Full CDR

- single locked-delivery primitive
- access controlled by Story-side conditions
- buyer wallet is the access credential
- durable purchases can map directly to entitlement tokens
- temporary access can use signed proofs
- less duplicate state and less bespoke access-job logic

## Recommendation

Pirate should adopt full CDR for locked assets.

Concrete recommendation:

- keep CDR optional for `public` assets
- make CDR the only delivery primitive for `locked` assets
- use entitlement-token-gated CDR reads for purchases
- use signed CDR proofs for temporary access
- do not carry forward the buyer-envelope architecture
- do not carry forward `ContentRegistry` as a core v2 purchase-access dependency

## Open Questions

- Should the entitlement token be ERC-721 or ERC-1155?
- Should entitlement tokens be strictly non-transferable in v0?
- Should temporary share proofs be issued by the main API signer registry or a separate signer family?
- What exact recovery payload format should Pirate standardize for audio assets and stem bundles?
