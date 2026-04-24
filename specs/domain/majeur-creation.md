# Majeur Creation

Status: current working spec

Related docs:

- [governance-backends.md](./governance-backends.md)
- [community.md](./community.md)
- [multisig-attachment.md](./multisig-attachment.md)

## Purpose

This doc defines the advanced club-creation path where the constitutional authority is a Majeur DAO from the start.

It covers:

- the minimum creation inputs
- what roles or allocations must exist at launch
- what presets Pirate should expose
- what gets attached back to the club

It does not cover:

- full contract deployment plumbing
- every optional Majeur module
- full DAO member UX after launch

## Core Principle

Creating a club with Majeur means creating a real on-chain governance system, not just choosing a future upgrade path.

Pirate should present it as an advanced flow for communities that intentionally want token-governed constitutional control from day one.

This doc mirrors Majeur's deployment boundary:

- top-level summon parameters
- `SafeConfig` governance parameters
- optional module paths that Pirate defers in v0

## What Must Exist At Launch

Minimum required governance inputs:

- chain selection
- org name
- org symbol
- at least one founding holder wallet
- initial share allocations
- `ragequittable`
- proposal threshold
- proposal TTL

Optional at launch:

- initial loot allocations
- `renderer`
- quorum basis points
- timelock delay
- absolute quorum
- minimum yes-vote threshold
- rollback guardian

This matches Majeur's `SafeSummoner.safeSummon(...)` shape and validation requirements.

## What Does NOT Need To Exist At Launch

Pirate should not require named DAO officer roles such as:

- treasurer
- secretary
- moderator
- board seat labels

Majeur governance power starts from token allocation, not app-level named roles.

Pirate operational roles may still exist separately after creation.

## Presets

Recommended v0 presets:

- `founder`
  - one founder wallet
  - initial shares hardcoded to `10_000_000e18`
  - proposal threshold hardcoded to `100_000e18`
  - 1 day voting
  - no timelock
  - 10% quorum
  - `ragequittable = true`
  - default renderer singleton
- `standard`
  - multi-holder setup
  - proposal threshold defaults to 1% of initial share supply, floored at 1
  - 7 day voting
  - 2 day timelock
  - 10% quorum
  - `ragequittable = true`
  - default renderer singleton
  - `lock_shares` remains a caller choice
- `fast`
  - multi-holder setup
  - proposal threshold defaults to 1% of initial share supply, floored at 1
  - 3 day voting
  - 1 day timelock
  - 5% quorum
  - `ragequittable = true`
  - default renderer singleton
  - `lock_shares` remains a caller choice
- `custom`
  - full top-level summon control plus `SafeConfig`

Recommended v0 product stance:

- Pirate may expose `ragequittable` in `custom`, but presets should keep it `true` to match current Majeur presets
- Pirate should label `ragequittable` clearly because it materially affects treasury exit rights

## Contract Parameter Boundary

Majeur's deployment interface splits inputs across two layers.

### Top-Level Summon Parameters

These map to `safeSummon(...)` directly:

- `org_name`
- `org_symbol`
- `org_uri`
- `quorum_bps`
- `ragequittable`
- `renderer`
- `salt`
- `init_holders`
- `init_shares`
- `init_loot`

### SafeConfig Parameters

These map into `SafeConfig`:

- `proposal_threshold`
- `proposal_ttl_seconds`
- `timelock_delay_seconds`
- `quorum_absolute`
- `min_yes_votes_absolute`
- `lock_shares`
- `lock_loot`
- `auto_futarchy_param`
- `auto_futarchy_cap`
- `futarchy_reward_token`
- `sale_active`
- `sale_pay_token`
- `sale_price_per_share`
- `sale_cap`
- `sale_minting`
- `sale_is_loot`
- `burn_singleton`
- `sale_burn_deadline`
- `rollback_guardian`
- `rollback_singleton`
- `rollback_expiry`

Pirate does not need to expose every `SafeConfig` field in v0, but any payload constructor must preserve the contract's top-level versus `SafeConfig` separation.

## Creation Inputs

Suggested v0 creation payload shape:

- `chain_id`
- `preset`
  - `founder`
  - `standard`
  - `fast`
  - `custom`
- `org_name`
- `org_symbol`
- `org_uri` nullable
- `quorum_bps` nullable
- `ragequittable`
- `renderer` nullable
- `init_holders`
  - ordered array of wallet addresses
- `init_shares`
  - ordered array matching `init_holders`
- `init_loot` nullable
  - ordered array matching `init_holders` when present
- `config`
  - `proposal_threshold`
  - `proposal_ttl_seconds`
  - `timelock_delay_seconds` nullable
  - `quorum_absolute` nullable
  - `min_yes_votes_absolute` nullable
  - `lock_shares`
  - `lock_loot`
  - `rollback_guardian` nullable
  - `rollback_singleton` nullable
  - `rollback_expiry` nullable

Recommended v0 stance:

- default most advanced users to `standard`
- reserve `custom` for expert communities
- do not expose sale, tap, LP seed, or futarchy settings in the first Pirate-facing version
- DAICO-style module paths are deferred scope, not forgotten scope; Majeur exposes them through `safeSummonDAICO(...)` and preset DAICO helpers, but Pirate should not surface them in the first governance launch
- Pirate should generate the CREATE2 salt rather than asking the user to supply it directly

## Creation Flow

Happy-path v0:

1. User chooses `Majeur DAO` governance.
2. User chooses chain.
3. User chooses preset.
4. User enters org metadata.
5. User enters founding wallets and share allocations.
6. User optionally enters initial loot allocations.
7. User confirms governance settings.
8. Pirate generates the deployment salt and builds the exact deploy payload.
9. Pirate previews the predicted DAO address and derived component addresses.
10. User signs the deployment transaction through the chosen wallet path rather than manually re-encoding calldata elsewhere.
11. Pirate records the deployment transaction hash and waits for confirmation.
12. Pirate verifies the deployed DAO and records it as the club governance backend.
13. Club creation finalizes with `governance_mode = majeur`.

Recommended v0 UX:

- Pirate should build the calldata, not ask the user to hand-assemble it
- Pirate should generate and persist the salt used for prediction and deployment
- the wallet signature step may still happen in an external signer environment, but Pirate should remain the source of the deploy payload
- if Pirate later supports redirecting to a dedicated governance dapp, it should still preserve `deployment_tx_hash` and attachment verification continuity

## Validation Rules

Recommended v0 checks:

- founding holder count must be at least one
- `proposal_threshold > 0`
- `proposal_ttl_seconds > 0`
- if `timelock_delay_seconds > 0`, then `proposal_ttl_seconds > timelock_delay_seconds`
- `quorum_bps <= 10000` when present
- share array length must match holder array length
- loot array length must match holder array length when loot is provided
- if Pirate later exposes futarchy, quorum must be non-zero when futarchy is enabled
- if Pirate later exposes futarchy, `auto_futarchy_cap > 0` when futarchy is enabled
- if Pirate later exposes sale settings, minting sale plus dynamic-only quorum must be rejected
- if `rollback_guardian` is set, `rollback_singleton` must also be set

Recommended v0 note:

- Pirate may defer futarchy and sale configuration UX while still validating that any generated payload stays compatible with Majeur's guardrails

## Chain Choice

Pirate may let the creator choose the chain, but only among chains Pirate supports for:

- wallet connection
- governance indexing
- transaction-status reconciliation
- treasury balance reads

Suggested v0 data model:

- `governance_chain_id`
- `governance_contract_address`
- `deployment_tx_hash`
- `deployment_status`
  - `draft`
  - `deploying`
  - `deployed`
  - `failed`

Status handoff:

- after the deployment transaction is confirmed and the DAO attachment is verified, `deployment_status = deployed` should transition into `governance_verification_state = verified` on the shared backend record
- failed deployment leaves the club attachment unverified and should not create a half-attached backend

## Prediction Dependencies

Pirate cannot predict addresses from user inputs alone.

Address prediction depends on the deployed Majeur singleton addresses for:

- `Summoner`
- `Moloch` implementation
- `Shares` implementation
- `Loot` implementation
- `Badges` implementation

Pirate should treat these addresses as chain-specific deployment metadata rather than hardcoded UI constants.

## Attached Contract References

After deployment Pirate should store:

- `governance_contract_address`
- `shares_address`
- `loot_address`
- `badges_address`
- `renderer_address` nullable

Interpretation:

- `governance_contract_address` is the DAO address
- `shares_address`, `loot_address`, `badges_address`, and `renderer_address` belong in `governance_metadata`
- these addresses are part of the backend metadata rather than separate club identity

## Treasury Interpretation

For a Majeur-backed club:

- the DAO contract is normally the constitutional treasury authority
- Pirate should treat treasury balances as read models
- constitutional treasury actions should follow DAO approval and execution rather than app-owner overrides
- if `ragequittable = true`, treasury balances are not fully sticky; members may exit with pro-rata value, so displayed balances should be understood as current rather than fully committed future spend

Recommended v0 read-model addition:

- surface whether the DAO is currently ragequittable alongside treasury balances

## Relationship To Pirate Roles

Majeur should govern constitutional actions.

Pirate should still manage operational roles such as:

- moderator
- community admin
- community agent operator

Recommended rule:

- do not route routine moderation through on-chain voting in v0

## Product Guidance

Recommended v0 UX:

- surface Majeur as an advanced governance path
- explain clearly that it creates a real DAO immediately
- default to presets rather than raw config
- treat deployment as a distinct external step, even if Pirate later automates more of it
- explain `lock_shares`, `lock_loot`, and `ragequittable` in plain language
- label `rollback_guardian` as an emergency recovery feature that can invalidate pending proposals by bumping DAO config

## Indexing Guidance

Recommended v0 read path:

- use Majeur's `MolochViewHelper` singleton as the default batch-read source when available
- fall back to direct contract reads when helper coverage is insufficient

Useful indexed fields include:

- share and loot balances
- delegation state
- proposal tallies and states
- treasury token balances
