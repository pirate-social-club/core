# Multisig Attachment

Status: draft

Related docs:

- [governance-backends.md](./governance-backends.md)
- [community.md](./community.md)
- [monetization.md](./monetization.md)

## Purpose

This doc defines how a club attaches an external multisig backend, usually a Safe.

It covers:

- what the multisig represents
- what data Pirate stores
- how attachment should work
- how multisig-backed actions should reconcile

It does not cover:

- Safe deployment internals
- every supported multisig implementation
- advanced module configuration inside the multisig itself

## Core Principle

The multisig sits outside Pirate as an on-chain smart account.

Pirate recognizes it as the club's constitutional authority and, in most cases, the club treasury wallet.

## What The Multisig Is

Recommended v0 interpretation:

- the multisig is a contract wallet on a chosen chain
- the multisig address is controlled by signer wallets under threshold rules
- the multisig address may hold treasury assets
- Pirate does not need to custody those assets to recognize the multisig

Typical v0 implementation:

- Safe-compatible multisig on EVM

## Attachment Fields

Suggested attachment fields:

- `governance_mode = multisig`
- `governance_chain_id`
- `governance_contract_address`
- `governance_treasury_address`
- `governance_verification_state`
- `governance_metadata`
  - `owners`
  - `threshold`
  - `implementation_label` nullable
  - `master_copy_address` nullable

Recommended v0 rule:

- `governance_treasury_address = governance_contract_address` unless Pirate later supports a split treasury model

## Attachment Flow

Happy-path v0:

1. Community owner chooses `Multisig` governance.
2. User chooses chain.
3. User either:
   - pastes an existing Safe address, or
   - creates one externally and returns with the address
4. Pirate verifies:
   - contract code exists at the address
   - the contract matches the expected multisig interface
   - the user can prove authorization to attach it through a Safe-compatible signature flow
5. Pirate snapshots owner and threshold metadata.
6. Pirate stores the multisig as the club governance backend.
7. Community moves to `governance_mode = multisig`.

## Verification

Suggested v0 checks:

- chain reachable and supported by Pirate
- contract code present
- interface-level verification for the chosen multisig type
- EIP-1271 signature verification from the multisig over a Pirate-issued attachment challenge

Recommended v0 stance:

- owner-wallet presence by itself is not enough proof for attachment on an M-of-N Safe
- Pirate should prefer EIP-1271 challenge signing for attach-governance
- if Pirate later supports fallback proofs, they should be additive rather than replacing the EIP-1271 path for Safe-compatible wallets

Suggested v0 statuses:

- `pending`
- `verified`
- `broken`

`broken` means Pirate can no longer confirm that the address behaves like the expected multisig backend.

## Treasury

For multisig-backed communities, the simplest treasury model is:

- the club treasury lives in the multisig
- Pirate reads balances and transaction history as an indexed view
- constitutional payout or treasury actions are executed by the multisig signers

Examples:

- club donation withdrawals route to the Safe
- namespace or handle-policy fees accumulate to the Safe
- future grants or treasury disbursements execute from the Safe

## Constitutional Action Flow

When a club action requires multisig approval:

1. Pirate creates a pending governance action.
2. Pirate produces a concrete action payload or calldata.
3. Signers approve and execute it in the multisig.
4. Pirate observes the successful execution transaction.
5. Pirate applies the corresponding club-state change.

When multiple constitutional actions are bundled together, Safe-style batching via MultiSend is a natural later optimization, but Pirate does not need to require batching in v0.

Examples:

- update namespace handle pricing
- rotate donation partner payout destination
- replace the current governance backend

## Non-Goals For V0

Pirate should not require multisig approval for:

- deleting a spam post
- banning a user
- changing a community rule sentence
- editing community labels

Those remain operational product actions unless Pirate later decides specific categories need constitutional approval.

## Product Guidance

Recommended v0 UX:

- let users attach an existing Safe before Pirate supports in-app Safe creation
- make chain choice explicit
- show current owners and threshold after verification
- explain clearly that the multisig is both the constitutional admin and usually the treasury wallet

Recommended launch posture:

- Pirate may keep multisig attachment modeled in the domain and API while deferring public v1 exposure
- if deferred, communities should still launch under `governance_mode = centralized` and later migrate to `multisig`
- public launch should wait until Safe verification, backend indexing, and execution reconciliation are reliable enough for security-sensitive use
- feature-flagged, allowlisted, or internal-only multisig support is acceptable before broad public launch

### Public v0 Path

Public v0 community creation must not expose multisig attachment. The only supported public create path is `governance_mode = centralized`. Create-time multisig is internal, allowlisted, or feature-flagged only.

Multisig attachment for public users happens exclusively after community creation through `POST /communities/{community_id}/attach-governance` with `governance_mode = multisig`. This separates the governance-upgrade flow from the create flow entirely.

The domain and API models for `CreateMultisigClubRequest` and `AttachMultisigGovernanceRequest` remain valid for internal and future use. They must not be removed. The public client must not call them at creation time.
