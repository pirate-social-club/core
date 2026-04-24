# Token Gate Condition

Status: active reference

Related docs:

- [overview.md](./overview.md)
- [locked-asset-delivery.md](./locked-asset-delivery.md)
- [purchase-entitlement-token.md](./purchase-entitlement-token.md)

## Purpose

This doc defines the recommended v0 Story CDR read condition for durable purchased access.

It covers:

- how token-gated CDR reads should work
- what condition data should encode
- how this differs from signed temporary-access conditions

## Core Principle

Durable purchase access should be validated directly from onchain entitlement ownership.

The condition should answer one narrow question:

- does `caller` currently hold the required entitlement for this locked asset version?

## Recommendation

Recommended v0 shape:

- one reusable Story-side read condition contract
- configured per vault by static `conditionData`
- checks buyer entitlement token ownership or balance

The contract should not interpret purchase price, expiry windows, or offchain policy.

## Condition Model

Recommended `readConditionData` encoding:

- `abi.encode(address entitlementToken, uint256 tokenId, uint256 minBalance)`

Recommended v0 values:

- `entitlementToken` = Pirate purchase entitlement token contract
- `tokenId` = locked asset version entitlement class
- `minBalance` = `1`

Read rule:

- return true when `IERC1155(entitlementToken).balanceOf(caller, tokenId) >= minBalance`

## Why This Shape

This gives Pirate:

- one reusable condition contract across all locked asset versions
- no per-buyer writes after settlement
- direct wallet-native proof of durable access
- no need for `ContentRegistry` as a second access-control ledger

## Non-Goals

This condition should not do:

- purchase settlement checks
- refund processing
- signature verification for temporary access
- royalty logic
- app-level user identity checks

Those belong elsewhere.

## Write Condition Pairing

Recommended v0 pairing:

- write condition should allow only the publish pipeline signer for initial vault write
- read condition should be this token gate for durable purchase access

This means the vault can be created once and read by any buyer who later acquires the correct entitlement token.

## Signed Access Split

This contract is for durable bought access only.

Temporary shares and delegated access should use a separate signed-proof read condition:

- token gate = durable purchase ownership
- signed access condition = short-lived delegated access

Pirate should not overload one condition with both responsibilities in v0.

## Revocation Semantics

The condition inherits its semantics from token ownership:

- mint = access granted
- burn = access revoked
- no token balance = no durable access

This keeps revocation logic simple and auditable.

## Interface Notes

CDR condition contracts must implement:

- `checkReadCondition(address caller, bytes conditionData, bytes accessAuxData) external view returns (bool)`

Recommended v0 rule:

- `accessAuxData` is unused for this condition and callers pass `0x`

That distinguishes it cleanly from the signed temporary-access path, where `accessAuxData` carries the proof and signature.

## Validation Rules

Recommended v0 checks:

- revert on zero token address
- revert on malformed `conditionData`
- allow any valid `tokenId`
- do not special-case buyer identity beyond the `caller` passed by CDR

The contract should stay extremely small.

## Recommended Contract Role

Suggested responsibilities:

- decode token-gate condition data
- query entitlement balance
- return boolean authorization result

Suggested non-responsibilities:

- class configuration
- token mint authority
- vault UUID bookkeeping
- namespace interpretation

Those belong to the entitlement token, publish coordinator, or signed-access condition.

## Open Questions

- Should v0 support ERC-721 and ERC-1155 gates in one condition, or keep the contract narrowly ERC-1155-first?
- Should Pirate include an optional `active class` check by calling the entitlement token, or keep the condition purely balance-based?
