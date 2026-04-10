# Governance Backends

Status: draft

Related docs:

- [community.md](./community.md)
- [multisig-attachment.md](./multisig-attachment.md)
- [majeur-creation.md](./majeur-creation.md)
- [namespace.md](./namespace.md)
- [monetization.md](./monetization.md)

## Purpose

This doc defines how a club binds external governance authority.

It covers:

- the backend types Pirate supports
- the difference between operational and constitutional authority
- the minimum shared data Pirate should store for any backend
- how Pirate should treat treasury ownership
- how externally approved actions reconcile back into app state

It does not cover:

- full smart contract deployment mechanics
- full Safe product UX
- full Majeur contract internals
- day-to-day moderator tooling

## Core Principle

Pirate remains the source of truth for club product state.

A governance backend is an approval authority for high-trust club actions, not a replacement for all app permissions and not a requirement for routine moderation.

## Backend Types

Current API/storage enum:

- `centralized`
- `multisig`
- `majeur`

Recommended product labels:

- `centralized` = `Creator-led`
- `multisig` = `Multisig`
- `majeur` = `Majeur DAO`

Meanings:

- `centralized`
  - one Pirate-controlled club owner path is the constitutional authority
  - no external contract address is required
- `multisig`
  - an external smart-account multisig, usually a Safe, is the constitutional authority
  - the same address may also serve as the club treasury
- `majeur`
  - a Majeur DAO contract is the constitutional authority
  - treasury assets and major governance decisions live under the DAO's on-chain rules

## Shared Backend Fields

Suggested v0 attachment fields:

- `governance_mode`
  - `centralized`
  - `multisig`
  - `majeur`
- `governance_chain_id` nullable
- `governance_contract_address` nullable
- `governance_verification_state`
  - `not_required`
  - `pending`
  - `verified`
  - `broken`
- `governance_display_label` nullable
- `governance_treasury_address` nullable
- `governance_attached_at` nullable
- `governance_last_verified_at` nullable
- `governance_metadata` nullable

Suggested interpretations:

- `governance_chain_id` is null for `centralized`
- `governance_contract_address` is null for `centralized`
- `governance_treasury_address` may equal `governance_contract_address`, but does not have to
- `governance_metadata` holds backend-specific read-model data such as Safe threshold or Majeur token addresses
- `broken` is a safety state meaning Pirate can no longer confidently verify or index the backend; for immutable backends such as a correctly deployed Majeur DAO, this should usually mean chain support, indexing, or interface-read failure rather than mutable contract drift

## Authority Split

Pirate should explicitly separate two classes of club action.

### Operational Authority

Operational authority is product-native.

Examples:

- moderation actions on posts, comments, and members
- label definitions
- community rules and resource links
- club profile copy and artwork
- anonymous presentation defaults
- routine creator-side content policy edits

These actions should not require on-chain execution in v0.

### Constitutional Authority

Constitutional authority is where the governance backend matters.

Examples:

- attach, replace, or remove a governance backend
- treasury withdrawals or treasury policy changes
- namespace binding changes
- donation partner and payout-destination changes
- handle-policy changes with material economic consequences
- artist-governance attachment and similar high-trust ownership transitions

These actions may require external approval depending on `governance_mode`.

## External Action Reconciliation

When an action requires external governance approval, Pirate should model it as a pending app action rather than mutating club state immediately.

Suggested v0 flow:

1. User initiates a constitutional change in Pirate.
2. Pirate validates the request against current community policy.
3. Pirate creates a pending governance action record.
4. Pirate prepares a backend-specific action payload.
5. The external backend approves and executes that payload.
6. Pirate verifies the execution on the specified chain.
7. Pirate finalizes the club-state mutation and marks the action as completed.

Suggested v0 governance action fields:

- `governance_action_id`
- `community_id`
- `action_kind`
- `requested_by_user_id`
- `governance_mode`
- `chain_id` nullable
- `target_address` nullable
- `payload_hash`
- `status`
  - `draft`
  - `awaiting_external_approval`
  - `executed`
  - `rejected`
  - `expired`
- `external_state` nullable
- `execution_tx_hash` nullable
- `created_at`
- `updated_at`

`external_state` is the backend-native lifecycle value when Pirate needs more precision than the coarse product status.

Examples:

- multisig
  - `proposed`
  - `pending_signatures`
  - `executed`
  - `failed`
- majeur
  - `unopened`
  - `active`
  - `succeeded`
  - `queued`
  - `executed`
  - `defeated`
  - `expired`

Recommended interpretation:

- `awaiting_external_approval` is a coarse Pirate status that may cover multiple backend-native states such as active voting, queued timelock, or pending multisig signatures

## Treasury Interpretation

The backend may also determine where treasury assets live.

Recommended v0 interpretation:

- `centralized`
  - treasury may be app-managed, creator-managed, or unset depending on product area
- `multisig`
  - treasury should normally point to the same multisig address
- `majeur`
  - treasury should normally point to the DAO contract unless a later module or wrapper changes that

Pirate should display treasury balances as read models. Pirate should not assume custody just because a club exists.

## Backend-Specific Metadata

### Multisig

Suggested metadata:

- `owners`
- `threshold`
- `version_label` nullable
- `is_safe_compatible`
- `master_copy_address` nullable

### Majeur

Suggested metadata:

- `shares_address`
- `loot_address`
- `badges_address`
- `renderer_address` nullable
- `ragequittable`
- `proposal_threshold`
- `proposal_ttl_seconds`
- `timelock_delay_seconds`
- `quorum_bps` nullable
- `quorum_absolute` nullable
- `min_yes_votes_absolute` nullable
- `shares_locked`
- `loot_locked`
- `auto_futarchy_param` nullable
- `auto_futarchy_cap` nullable
- `futarchy_reward_token` nullable
- `config_version`

## Migration Rules

Recommended v0 rules:

- changing `governance_mode` must not create a new `community_id`
- `centralized -> multisig` is allowed
- `centralized -> majeur` is allowed
- `multisig -> majeur` is allowed
- `majeur -> multisig` may be allowed later, but should be treated as a serious constitutional action
- governance migration should not retroactively invalidate normal moderation history or namespace ownership history

Important asymmetry:

- `centralized -> multisig` mainly attaches a new constitutional backend
- `majeur -> multisig` may also require treasury asset migration, proposal approval inside the old DAO, and recognition that dissenting members may ragequit before execution
- the old DAO persists on-chain even after Pirate points the club at a different backend

## Product Guidance

Recommended v0 product stance:

- default new communities to `centralized`
- keep `multisig` in the domain model and API as the first advanced governance backend
- public v1 may defer user-facing `multisig` launch until Safe verification, indexing, and reconciliation are production-ready
- if deferred, `multisig` should remain available as a planned or internal capability rather than being removed from the model
- support `majeur` as a separate advanced creation and attachment flow, not as a generic hidden implementation of `dao_ready`
- expose clear user-facing language about what each backend governs
