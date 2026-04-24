# Lit Actions

Repo-local Lit Action source and stamped outputs for the current Pirate control plane.

Principles:

- source templates live in this tree
- stamped outputs are generated from source templates plus repo config
- action CIDs are recorded in [lit-families.json](../config/lit-families.json)
- runtime secrets do not live here
- control-plane scripts live under [scripts/lit](../scripts/lit)

Current first-wave scope:

- `story-operator` action for `publishAssetVersion(...)`

Second-wave actions such as settlement and access-proof signing should follow the same shape after the operator lane is proven.
