# Hosted Runtime Chain-Writer Inventory

This is the prerequisite inventory for wallet-scoped serialization. The nonce
domain is `(chain_id, signer_address)`, not a job type, environment-variable
name, or SDK backend. Addresses are resolved per environment from
`config/runtime-wallet-registry.json`.

`config/lit-families.json` records the retired Lit design. It is not the hosted
runtime inventory.

## Active writers

| Chain | Runtime family | Backend | Production call sites | Durable execution state | Serialization status |
|---|---|---|---|---|---|
| Story Aeneid (1315) | `story-operator` | Hosted direct key | Story SDK original/derivative registration in `story-royalty-registration-service.ts`; publish binding in `story-publish-service.ts` | Registration has an immutable effect journal and job-attempt fencing; publish uses its existing publish state | Registration is fail-closed on unknown outcome, but operator-wide nonce serialization is not yet implemented |
| Story Aeneid (1315) | `story-entitlement-class-configurer` | Hosted direct key | Entitlement-class configuration in `story-publish-service.ts` | Publish state | No wallet-scoped executor yet |
| Story Aeneid (1315) | `story-cdr-writer` | Hosted direct key | CDR `allocate(...)` and `write(...)` in `story-cdr.ts`, plus locked replay and asset-delivery callers | Delivery/provisioning state | No wallet-scoped executor yet; multi-transaction operation requires per-subtransaction journaling |
| Story Aeneid (1315) | `story-settlement` | Hosted direct key | `payRoyaltyOnBehalf(...)`, `transferToVault(...)`, and `mintEntitlement(...)` in `story-royalty-settlement-service.ts` | Purchase settlement effects | No wallet-scoped executor yet; all three calls share one nonce domain per environment |
| Story Aeneid (1315) | `story-access-controller` | Hosted direct key | EIP-712 access proof signing in `story-access-proof-service.ts` | None required for nonce safety | Offchain signature only; not a chain-writer |
| Base Sepolia (84532) | booking settlement | Hosted direct key | USDC transfer through `operator-chain-real.ts` | Durable Object inbox, operation journal, alarms, receipt reconciliation | Serialized by wallet-scoped coordinator |
| Base Sepolia (84532) | rewards settlement | Hosted direct key | USDC transfer through `operator-chain-real.ts` | Durable Object inbox, operation journal, alarms, receipt reconciliation | Serialized separately from booking; configuration rejects a shared same-chain signer |
| Base source chain | Endaoment payout | `ENDAOMENT_PAYOUT_PRIVATE_KEY`, with legacy checkout-key fallback | USDC approval and donation in `endaoment-payout-service.ts` | Payout application state | No wallet-scoped executor yet; remove the shared checkout-key fallback before unattended concurrency |

Production currently aliases the `story-access-controller` address to the
`story-operator` address. That does not create nonce contention because access
proofs are offchain signatures, but it is still a blast-radius exception to the
preferred one-purpose-per-key policy.

## Required invariants for new writers

1. Resolve the concrete chain ID and signer address before reserving work.
2. Key serialization by `(chain_id, signer_address)` and keep different purposes
   separate only when they use different funded signers.
3. Persist immutable transaction-shaping input before the first external call.
4. Journal each subtransaction as `intent -> broadcast(tx_hash) ->
   confirmed | reverted | reconciliation_required`.
5. Treat an exception after entering an SDK that owns signing/broadcast as an
   unknown outcome unless absence of broadcast can be proven.
6. Keep business uniqueness constraints and job-attempt fencing even when a
   wallet executor is present; alarms, migration windows, and bypass paths can
   still duplicate work.
7. Callers submit durable intent and converge later. They must not assume a
   Durable Object RPC remains exclusive across external-I/O awaits.

## Next migration boundary

Move the three `story-settlement` operations first because they already share a
single signer and can execute concurrently on different community shards. Then
move Story registration/publish operations for `story-operator`. CDR migration
follows after its two-step allocate/write journal is explicit.
