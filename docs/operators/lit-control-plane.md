# Lit Control Plane

Explains the Lit/PKP execution model for pirate-v2. The machine-readable source of truth is `config/lit-families.json`. This document explains the model, policies, and operational procedures for PKP-backed families only.

Related:

- [lit-action-port-plan.md](/home/t42/Documents/pirate-v2/docs/operators/lit-action-port-plan.md)

## Model

Every Lit-backed signer family follows this structure:

1. **Signer family** — the on-chain identity and authority. Defined in `docs/operators/signer-families.md`.
2. **Execute group** — the Lit access-control group that governs who can request a signature from the PKP. One group per family per environment.
3. **Usage key** — an execute-only API key scoped to a single execute group. Stored in Infisical at `dev:/services/api`. The worker holds this key at runtime and uses it to request PKP signatures.
4. **PKP** — the Lit-managed key pair. The address is the signer identity. The private key never leaves Lit.
5. **Action** — a stamped Lit Action uploaded to IPFS. Most actions correspond to one contract method call on one chain; some families may instead sign typed data for a verifying contract. The action CID is version-controlled, not secret.

Special case:

- `story-access-controller` is intentionally a signature-producing family, not a transaction-submission family
- its Lit action should return an EIP-712 signature for `SignedAccessConditionV1` rather than submit a contract call
- this means its action template will differ from the contract-call stamping templates used by funded PKP families

## Source of Truth Map

| Concept | Canonical location |
|---|---|
| Signer address, on-chain authority, grants | `docs/operators/signer-families.md` |
| Execute group, usage key, PKP address, action CIDs | `config/lit-families.json` |
| Usage key secret value | Infisical `dev:/services/api` |
| Funded wallet balances and refill policy | `docs/product/funds-ledger.md` |

If two sources disagree, the above priority wins. If `config/lit-families.json` says one PKP address and wrangler.toml says another, `config/lit-families.json` is correct and wrangler.toml is stale.

## Policies

### No automatic fallback

If a PKP path fails, the worker must not silently fall back to a direct private key. The failure surfaces, a human investigates, and the fix is explicit. This is the single most important policy. pirate/ accumulated six legacy fallback keys that persisted for months because fallback was easy and diagnosis was not.

This policy does not prohibit explicit direct-key families. If a family is defined as `direct-key` in `docs/operators/signer-families.md`, that is its primary signer kind, not a fallback from PKP.

### One usage key per family

Each execute group has exactly one active usage key in the worker runtime. If a usage key is compromised, it is rotated by:
1. Creating a new execute-only key in the Lit dashboard scoped to the same group.
2. Updating the Infisical secret.
3. Redeploying the worker.

The PKP address and action CIDs do not change during usage key rotation.

### No account-scoped keys in worker runtime

`LIT_CHIPOTLE_ACCOUNT_API_KEY` is for control-plane operations only: uploading new action CIDs, syncing actions to groups, managing group membership. It must never be present in worker runtime env. Control-plane operations are run from a human operator's machine, not from the worker.

### Action CIDs are version-controlled

Every action CID is a public identifier. It lives in `config/lit-families.json` and is checked into the repo. It is not a secret. If an action CID is wrong, it is a code bug, not a secret rotation.

### Environment isolation

Dev execute groups, dev usage keys, and dev PKPs must not be shared with staging or production. The family name and structure carries over, but every control-plane object is environment-specific.

## Operational Procedures

### Local validation

Run the local checker after editing `config/lit-families.json`, `docs/operators/signer-families.md`, or `docs/product/funds-ledger.md`:

```bash
rtk node scripts/check-lit-config.mjs
```

This validates:

- JSON structure and required fields
- family, execute-group, and usage-key uniqueness
- signer-family anchor references
- config-declared funded-address placeholders in `docs/product/funds-ledger.md`

### Stamp a new action

1. Write or update the action source for the target contract method.
2. Run the stamp script with the correct chain ID, contract address, PKP address, and PKP public key.
3. Review the stamped file before upload.
4. Upload to IPFS and record the CID.
5. Update `config/lit-families.json` with the new CID.
6. Commit the config change.

### Sync an action to a Lit group

1. Use the account-scoped control-plane key (not a runtime usage key).
2. Sync the action CID to the target execute group.
3. Confirm the action appears in the Lit dashboard for that group.

### Rotate a usage key

1. Create a new execute-only usage key in the Lit dashboard, scoped to the target group.
2. Update the Infisical secret at `dev:/services/api` for the corresponding env var name.
3. Redeploy the worker.
4. Confirm the family still passes smoke.
5. Delete the old usage key from the Lit dashboard.

### Replace a PKP

This is the most disruptive operation. Do not do it lightly.

1. Mint a new PKP in the correct Lit account.
2. Restamp all actions for the affected family with the new PKP address and public key.
3. Upload the new stamped actions to IPFS.
4. Create a new execute group for the new PKP.
5. Create a new usage key scoped to the new group.
6. Update Infisical, `config/lit-families.json`, and `docs/operators/signer-families.md`.
7. Fund the new PKP address on the target chain.
8. Grant required on-chain roles to the new PKP address.
9. Deploy the worker with new config.
10. Smoke the new path.
11. Revoke on-chain roles from the old PKP.
12. Sweep remaining funds from the old PKP.
13. Delete the old execute group, usage key, and dashboard artifacts.

### Doctor check

The doctor script should read `config/lit-families.json` and validate:

- Each PKP address derives from its stated public key.
- Each action CID is reachable on IPFS.
- Each usage key env var is set in the worker runtime (without reading the value).
- Each PKP address has the required on-chain grants per `docs/operators/signer-families.md`.
- Each funded PKP address has a balance above the floor defined in `docs/product/funds-ledger.md`.

## What Changed From pirate/

| Problem in pirate/ | Fix in pirate-v2 |
|---|---|
| PKP addresses, public keys, and action CIDs scattered across wrangler.toml, release manifests, grants checklists, and dashboard inventories | Single source of truth in `config/lit-families.json` |
| Legacy fallback keys persisted for months alongside PKP keys | No fallback keys. PKP-only from the start. |
| Account-scoped key sometimes leaked into worker runtime | Explicit policy: account keys are control-plane only, never in worker env. |
| 8+ Lit-related env var prefixes in wrangler.toml (`STORY_SPONSOR_*`, `STORY_BACKEND_*`, `STORY_OPERATOR_*`, etc.) | All PKP config in `config/lit-families.json`. Runtime only holds usage key secrets. |
| Six reactive rollout docs written during the PKP migration | Four upfront inventory docs + one machine-readable config, written before secrets are migrated. |

## Out Of Scope In v0

`story-scrobble-operator` is intentionally out of scope for the Lit control plane in v0. Pirate-v2 batch scrobble anchoring uses a dedicated direct-key publisher on `ScrobbleV1`, defined in `docs/operators/signer-families.md` and funded via `docs/product/funds-ledger.md`. It is not represented in `config/lit-families.json` until a future PKP migration is real.
