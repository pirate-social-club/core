# Lit Action Port Plan

Audit of what `pirate-v2` should reuse from `pirate/` for Lit action stamping, upload, and sync.

## Current State In pirate-v2

What already exists:

- signer-family inventory in [signer-families.md](./signer-families.md)
- control-plane inventory in [lit-families.json](../../config/lit-families.json)
- control-plane policy doc in [lit-control-plane.md](./lit-control-plane.md)
- live Story Aeneid delivery deployment in [story-aeneid-delivery.json](../../config/story-aeneid-delivery.json)

Implemented in this first pass:

- repo-local Lit action source tree under [lit-actions](../../lit-actions)
- first `story-operator` source action for `publishAssetVersion(...)`
- config-aware stamp script under [scripts/lit](../../scripts/lit)
- local bundle/CID derivation script
- Lit group sync script
- real `publish-asset-version` CID recorded in [lit-families.json](../../config/lit-families.json)
- runtime smoke script and PKP-group membership enforcement in sync
- clean PKP rekey path using a temporary Lit probe action to derive the real public key of a newly minted wallet
- replacement `story-operator` PKP now live in v2 with a passing smoke for `publishAssetVersion(...)`

Still missing:

- broader multi-family action coverage beyond `story-operator`

This means the control-plane model is now real for the first `story-operator` action, including a full mint -> derive public key -> stamp -> sync -> smoke rotation path, but not yet complete across the rest of the family set.

## What pirate/ Already Has

The old repo contains a real Lit action layout under:

- `/home/t42/Documents/pirate/pirate-api/services/api/lit-actions/`

That structure already includes:

- per-family source templates
- per-family stamped outputs
- a shared transaction-signing helper
- dedicated stamp scripts
- generic upload and sync scripts
- a control-plane CLI for group / key / PKP management

Relevant reusable pieces:

### Reusable Action Template Pattern

Old families such as:

- `story-operator`
- `story-settlement`
- `story-access-controller`
- `story-feed-registrar`

follow the same pattern:

1. source template with placeholder `EXPECTED` constants
2. stamp script replaces those constants with concrete values
3. stamped output is bundled/uploaded to IPFS
4. Lit group sync attaches the CID to the execute group

This pattern is still correct for `pirate-v2`.

Exception:

- `story-scrobble-operator` is intentionally out of scope for the Lit control plane in v0 because Pirate v2 uses a direct-key `ScrobbleV1` batch publisher rather than a PKP-backed scrobble family.

### Reusable Shared Helper

The old shared helper at:

- `/home/t42/Documents/pirate/pirate-api/services/api/lit-actions/story-operator/_shared.js`

already does the hard parts correctly:

- strict unsigned-tx envelope validation
- expected chain / contract / selector checks
- zero-value enforcement
- PKP address/public-key self-check
- EIP-1559 transaction signing
- sequence signing for multi-tx flows

This is the most reusable piece in the old stack.

### Reusable Stamp Script Pattern

The old scripts:

- `story-operator-stamp.ts`
- `story-access-controller-stamp.ts`
- `story-settlement-stamp.ts`

all follow a simple replace-and-write model:

- read template
- replace `EXPECTED.*` fields
- rewrite imports for stamped output
- write deterministic file into `stamped/`

That pattern is fully portable.

### Reusable Upload / Sync Logic

The old scripts:

- `lit-action-upload.ts`
- `lit-action-sync.ts`
- `lit-control-plane.ts`

contain the real control-plane integration:

- bundle source
- reject placeholder constants
- upload to IPFS
- register action CID with Lit
- attach action to execute group
- create or rotate usage keys
- optionally execute a smoke call

These scripts are reusable conceptually, but not all of their dependencies should be ported verbatim.

## What Should Not Be Ported Wholesale

### Old Worker-Coupled Runtime Wiring

The old repo mixed Lit action tooling with worker/runtime concerns inside:

- `/home/t42/Documents/pirate/pirate-api/services/api/src/routes/music/...`

Examples:

- storage helpers for upload
- runtime PKP execution wrappers
- music-route-specific env resolution
- embedded action bundling into generated TS files

`pirate-v2` should not copy this coupling.

Reason:

- the new repo already separates inventory/config better
- the delivery contracts are their own workspace
- control-plane tooling should be repo tooling, not buried inside a runtime service implementation

### Old Access-Controller Semantics

The old action:

- `story-access-controller-grant-access.js`

is not reusable as-is because it signs:

- `PublishCoordinatorV1.grantAccess(bytes32,address)`

That model is intentionally gone in `pirate-v2`.

The v2 replacement family is:

- `story-access-controller`

but its role is now:

- produce EIP-712 `AccessProof` signatures for [SignedAccessConditionV1.sol](../../pirate-contracts/story/delivery/src/SignedAccessConditionV1.sol)

So this family needs a new action shape, not a port.

### Old Settlement Action Semantics

The old settlement family signed:

- ERC-20 `approve(...)`
- `RoyaltyModule.payRoyaltyOnBehalf(...)`
- royalty-sync sequences

That is not the current v1 settlement path.

The live v1 settlement contract is:

- [MarketplaceSettlementV1.sol](../../pirate-contracts/story/delivery/src/MarketplaceSettlementV1.sol)

So the first v2 settlement action should target:

- `MarketplaceSettlementV1.settlePurchase(...)`

not the old royalty-module flow.

The old sequence-signing helper is reusable, but the action logic is not.

## Minimum Port For pirate-v2

The smallest sensible control-plane port is:

### 1. Create A Repo-Local Lit Actions Directory

Recommended new layout:

- `lit-actions/_shared/`
- `lit-actions/story-operator/`
- `lit-actions/story-access-controller/`
- `lit-actions/story-settlement/`

The simplest path is to preserve the old per-family layout:

- `lit-actions/story-operator/_shared.js`
- `lit-actions/story-operator/publish-asset-version.js`
- `lit-actions/story-operator/stamped/`

This keeps migration friction low.

### 2. Port The Shared Signing Helper

Port and trim:

- `story-operator/_shared.js`

Keep:

- tx envelope validation
- selector checks
- PKP address/public-key checks
- `signConstrainedTx`
- `signConstrainedTxSequence`

Trim:

- helpers only used by old action families
- old content-addressed-ref checks unless needed immediately

### 3. Port A Minimal Stamp Script

First required script:

- `scripts/lit/story-operator-stamp.mjs` or `.ts`

This only needs to stamp one new action initially:

- `publish-asset-version`

Inputs should come from repo config, not ad hoc env sprawl:

- PKP address from [lit-families.json](../../config/lit-families.json)
- contract address from [story-aeneid-delivery.json](../../config/story-aeneid-delivery.json)
- RPC URL supplied explicitly or from deploy metadata

### 4. Write The New `publishAssetVersion` Action

This is the first true blocker to clear.

It should:

- constrain `to` to deployed `AssetPublishCoordinatorV1`
- constrain selector to `publishAssetVersion(...)`
- require zero ETH value
- decode and validate all 9 calldata fields
- sign only if the request matches the stamped constants

Important v2-specific checks:

- `publisher` must be non-zero
- `assetVersionId`, `namespace`, `contentHash`, `storageRefHash` must be non-zero `bytes32`
- `cdrVaultUuid` must be non-zero
- `entitlementTokenId` must be non-zero
- `readCondition` and `writeCondition` must be non-zero

### 5. Port Minimal Upload / Sync Tooling

Do not port the entire old worker-integrated upload stack first.

Port only:

- bundle source
- upload bundled action to IPFS
- attach CID to execute group

That can start as two scripts:

- `scripts/lit/lit-action-upload.mjs`
- `scripts/lit/lit-action-sync.mjs`

These should use:

- account-scoped control-plane key from `dev:/local/lit`
- execute group name / family mapping from [lit-families.json](../../config/lit-families.json)

### 6. Record The CID Back Into Config

After upload/sync:

- replace `cid: "TBD"` for `story-operator -> publish-asset-version` in [lit-families.json](../../config/lit-families.json)

That must be part of the workflow, not a side note.

## Recommended Implementation Order

1. port `lit-actions/story-operator/_shared.js`
2. create `lit-actions/story-operator/publish-asset-version.js`
3. create `scripts/lit/story-operator-stamp.*`
4. create minimal `lit-action-upload.*`
5. create minimal `lit-action-sync.*`
6. stamp `publish-asset-version`
7. upload to IPFS and get CID
8. sync to `story-operator-aeneid-v1`
9. update [lit-families.json](../../config/lit-families.json)
10. smoke against live [AssetPublishCoordinatorV1.sol](../../pirate-contracts/story/delivery/src/AssetPublishCoordinatorV1.sol)

## What Can Wait

These do not need to be implemented before `publishAssetVersion(...)`:

- v2 access-controller proof-signing action
- v2 settlement PKP action for `settlePurchase(...)`
- generic multi-family stamp automation
- generated embedded action bundles
- usage-key rotation tooling
- full control-plane CLI parity with `pirate/`

Those are second-wave tasks.

## Audit Conclusion

`pirate-v2` should not invent Lit action infrastructure from scratch.

It should:

- reuse the old action-template + stamp + upload + sync model
- port the shared transaction-signing helper
- rebuild only the family-specific action logic that changed semantically in v2

The first minimum viable port is:

- one new `story-operator` action for `publishAssetVersion(...)`
- one stamp script
- one upload script
- one sync script

That is enough to unblock publish automation on top of the already-deployed delivery contracts.
