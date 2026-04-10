# Lit Scripts

Minimal control-plane scripts for `pirate-v2`.

Current first-wave scope:

- stamp the `story-operator` `publishAssetVersion(...)` action against the live Story Aeneid delivery deployment

Current files:

- [story-operator-stamp.mjs](/home/t42/Documents/pirate-v2/scripts/lit/story-operator-stamp.mjs)
- [_lib/config.mjs](/home/t42/Documents/pirate-v2/scripts/lit/_lib/config.mjs)
- [_lib/action-source.mjs](/home/t42/Documents/pirate-v2/scripts/lit/_lib/action-source.mjs)
- [_lib/lit-api.mjs](/home/t42/Documents/pirate-v2/scripts/lit/_lib/lit-api.mjs)
- [lit-action-upload.mjs](/home/t42/Documents/pirate-v2/scripts/lit/lit-action-upload.mjs)
- [lit-action-sync.mjs](/home/t42/Documents/pirate-v2/scripts/lit/lit-action-sync.mjs)

Stamp dry run:

```bash
rtk node scripts/lit/story-operator-stamp.mjs \
  --dry-run
```

Notes:

- the script reads the deployed `AssetPublishCoordinatorV1` address from [story-aeneid-delivery.json](/home/t42/Documents/pirate-v2/config/story-aeneid-delivery.json)
- it reads the operator PKP address from [lit-families.json](/home/t42/Documents/pirate-v2/config/lit-families.json)
- it reads the operator PKP public key from [lit-families.json](/home/t42/Documents/pirate-v2/config/lit-families.json)
- Lit bundle/CID step:

```bash
rtk bun scripts/lit/lit-action-upload.mjs \
  --file lit-actions/story-operator/stamped/publish-asset-version.stamped.js
```

- Lit group sync step:

```bash
rtk bun scripts/lit/lit-action-sync.mjs \
  --family story-operator \
  --file lit-actions/story-operator/stamped/publish-asset-version.stamped.js
```

- If a family group should contain exactly one canonical PKP, you can prune stray group wallets during sync:

```bash
rtk bun scripts/lit/lit-action-sync.mjs \
  --family story-operator \
  --prune-other-pkps \
  --file lit-actions/story-operator/stamped/publish-asset-version.stamped.js
```

- Lit runtime smoke:

```bash
rtk bun scripts/lit/lit-action-smoke.mjs \
  --family story-operator \
  --file lit-actions/story-operator/stamped/publish-asset-version.stamped.js
```

If you do not yet have a control-plane account key, you can create a fresh Lit account during sync:

```bash
rtk bun scripts/lit/lit-action-sync.mjs \
  --family story-operator \
  --file lit-actions/story-operator/stamped/publish-asset-version.stamped.js \
  --create-account-name pirate-v2-story-operator-dev
```

- `lit-actions/package.json` carries the local `ethers` dependency used for bundling Lit Action templates
- sync currently creates a usage key unless `--skip-usage-key` is passed
- sync now also ensures the family PKP is attached to the execute group, and `--prune-other-pkps` can enforce single-PKP membership
- if `--create-account-name` is used, the script returns the newly created account API key so it can be stored under `dev:/local/lit`
- the smoke script signs a harmless unsigned tx locally through Lit; it does not broadcast anything onchain
