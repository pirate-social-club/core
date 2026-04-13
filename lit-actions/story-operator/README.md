# Story Operator Lit Actions

This directory contains source templates for the `story-operator` PKP family.

Current scope:

- `publish-asset-version.js` for [AssetPublishCoordinatorV1.sol](../../pirate-contracts/story/delivery/src/AssetPublishCoordinatorV1.sol)

These templates are not uploaded directly. They are stamped first with:

- deployed contract address from [story-aeneid-delivery.json](../../config/story-aeneid-delivery.json)
- PKP address from [lit-families.json](../../config/lit-families.json)
- PKP public key from [lit-families.json](../../config/lit-families.json)

Stamp command:

```bash
rtk node scripts/lit/story-operator-stamp.mjs --dry-run
```
