# Community Asset-Balance Gates

Status: proposed contract for implementation

## Goal

Allow a community policy to require an attached-wallet balance, such as "hold at least 10 of this token," without making the persisted gate specific to EVM, Alchemy, or any other chain/provider.

This atom complements NFT collection and trait gates. It covers fungible native assets and fungible tokens; it does not replace `erc721_holding` or inventory/trait matching.

## Canonical atom

```json
{
  "type": "asset_balance",
  "asset_id": "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "min_amount_atomic": "10000000"
}
```

Rules:

- `asset_id` is a canonical CAIP-19 asset identifier.
- The CAIP-19 chain id inside `asset_id` is the sole chain identity. The atom must not add a parallel `chain_namespace` field.
- `min_amount_atomic` is a base-10 unsigned integer string in the asset's smallest indivisible unit.
- `min_amount_atomic` must be greater than zero, contain only ASCII digits, have no sign or decimal point, and have no leading zeroes.
- Policy never stores display decimals, ticker symbols, prices, RPC URLs, provider names, or floating-point amounts.
- V1 authoring and evaluation supports Ethereum mainnet native ETH and allowlisted ERC-20 contracts. The contract is intentionally compatible with later Bitcoin, Solana, and additional EVM-chain evaluators.

Examples:

```json
{ "type": "asset_balance", "asset_id": "eip155:1/slip44:60", "min_amount_atomic": "1000000000000000000" }
{ "type": "asset_balance", "asset_id": "bip122:000000000019d6689c085ae165831e93/slip44:0", "min_amount_atomic": "100000" }
```

The Bitcoin example is contract-shaped but is not public-authoring support until a Bitcoin balance evaluator is registered.

## Asset and evaluator registry

Validation is closed-world. Saving a policy succeeds only when `asset_id` resolves through the server-owned asset/evaluator registry.

Each registry entry owns:

- canonical CAIP-19 identity and aliases accepted only for input normalization;
- chain family and wallet-address namespace;
- evaluator adapter id and enabled environments;
- asset standard (`native`, `erc20`, later `bitcoin`, `spl`, or another registered standard);
- display metadata such as name, symbol, and decimals;
- public-authoring availability and any risk/denylist posture;
- evaluator policy such as confirmation depth, finality tag, timeout, cache bounds, and maximum query fan-out.

Persisted policy stores only the canonical `asset_id`. Registry edits must not reinterpret that id as a different asset. Display metadata may change, but chain, standard, and asset reference are immutable identity.

An evaluator missing or disabled in the current environment is a save-time validation error, not a policy that can be saved and fail later. Existing policies whose evaluator is subsequently disabled remain readable and fail closed with `provider_unavailable` until support returns or a moderator explicitly replaces them.

This registry seam should be shared with other provider/chain capability registries rather than adding another atom-specific literal switch.

## Evaluation

Evaluation considers only currently attached, verified wallet addresses matching the chain id embedded in `asset_id`.

For each matching wallet, the evaluator obtains a non-negative atomic-unit balance and sums balances using arbitrary-precision integers. JavaScript `number`, floating point, and display-decimal arithmetic are forbidden.

The result passes when:

```text
sum(eligible attached-wallet balances) >= min_amount_atomic
```

Aggregation is monotonic across wallets:

- if successfully queried wallets already satisfy the threshold, the atom passes even if another wallet query is unavailable;
- if the successful subtotal is below threshold and any balance that could affect the result is unavailable, the result is `provider_unavailable`, not "insufficient";
- if every required query succeeds and the subtotal is below threshold, the result is `action_required`;
- no matching attached wallet is an actionable zero-balance state, not a provider outage.

Evaluators must reject malformed, negative, overflowing, or non-integer provider responses. Provider failure, timeout, rate limiting, inconsistent chain identity, and unverifiable partial results fail closed as `provider_unavailable`.

Membership follows the existing gate lifecycle: evaluate on join and re-evaluate on gated writes. A prior pass or membership grant is not a permanent balance snapshot. Balance gates are volatile, so cached provider observations must use a substantially shorter freshness bound than durable identity proofs.

## Required action and trace

Insufficient balance is remediable and therefore maps to `action_required`, never `terminal_mismatch`.

The typed required action is:

```json
{
  "kind": "action",
  "provider": "wallet",
  "capability": "asset_balance",
  "asset_id": "eip155:1/slip44:60",
  "required_amount_atomic": "1000000000000000000",
  "current_amount_atomic": "750000000000000000",
  "shortfall_amount_atomic": "250000000000000000"
}
```

Rules:

- `current_amount_atomic` is the successfully established aggregate when evaluation is complete.
- `shortfall_amount_atomic` equals `required - current`; the server computes it with arbitrary-precision integers.
- provider outages do not manufacture a current balance or shortfall and do not emit this action as though the user were merely underfunded.
- clients resolve human-readable symbol and decimal formatting through server-provided registry presentation data; they must not infer decimals from the identifier.
- recursive AND/OR policy rendering consumes the normal evaluation trace and `RequiredActionSet`; it must not flatten this atom into a top-level pass/fail guess.

## EVM V1

V1 adapters support:

- `eip155:1/slip44:60` through `eth_getBalance`;
- allowlisted `eip155:1/erc20:<contract>` assets through `balanceOf(address)` at a consistent block tag.

Requirements:

- normalize ERC-20 contract references to the registry's canonical form;
- verify the RPC reports the expected chain id;
- use one consistent block tag for all wallet reads in a single atom evaluation where the provider permits it;
- do not trust token `symbol`, `name`, or `decimals` as authorization data at evaluation time;
- treat proxy upgrades, fee-on-transfer behavior, rebasing, paused transfers, and malicious metadata as registry/risk concerns. The gate asserts balance only, not liquidity or transferability;
- keep the runtime configuration named by transport/function (for example `ETHEREUM_RPC_URL`), not by vendor.

Alchemy may provide the initial RPC transport. It is not named in the atom, registry identity, summaries, or required actions.

## Bitcoin extension

Bitcoin wallet attachment and script-pubkey derivation already provide the identity rail. A future evaluator may query UTXOs by derived script pubkey without changing the atom.

The evaluator must define centrally, not per policy:

- confirmed-UTXO-only behavior;
- minimum confirmation depth;
- treatment of mempool spends, reorgs, immature coinbase outputs, and provider disagreement;
- whether multiple script types attached to one user are aggregated.

The default contract posture is confirmed spendable outputs only. Confirmation depth is an evaluator-registry policy so communities cannot weaken finality independently.

## Solana extension

No Solana evaluator is registered until the platform has an ed25519 wallet-attachment/proof rail for the corresponding CAIP-2 namespace. Once that exists, native SOL and registered SPL-token adapters use the same `asset_balance` atom and atomic-unit semantics.

## Authoring and presentation

The builder selects an asset from a server-provided registry/catalog. Arbitrary contract paste may be offered only if the server can resolve it to an enabled canonical registry entry before save.

Authoring displays a decimal amount for humans but converts it losslessly to `min_amount_atomic` using registry decimals before save. It must reject:

- precision beyond the registered decimals;
- zero or negative thresholds;
- scientific notation;
- unsupported or disabled assets;
- values above server policy bounds.

Summaries and member-side required actions carry `asset_id` plus atomic strings. Presentation metadata is additive and non-authoritative. A missing metadata lookup must degrade to the canonical asset id, never change evaluation.

## Security and privacy

- Balance providers are replaceable adapters and never policy authorities.
- Logs and traces must not include RPC credentials.
- Public policy may expose the required asset and threshold; user wallet balances remain authenticated/private evaluation data.
- Cache keys must include canonical asset id, wallet address, and chain/finality context.
- Rate limits and query caps apply before wallet fan-out.
- Price-denominated gates are out of scope. A future "$N worth" gate requires explicit oracle, timestamp, denomination, and manipulation semantics and must not overload `asset_balance`.

## Delivery order

1. Core/OpenAPI atom, summary, trace, and required-action contracts.
2. Shared asset/evaluator registry validation seam.
3. API arbitrary-precision evaluation with EVM native and allowlisted ERC-20 adapters.
4. Focused API tests for aggregation, partial outage, precision, chain mismatch, and action shortfall.
5. Builder asset picker and lossless decimal-to-atomic input.
6. Trace-driven member presentation.
7. Staging live smoke, then production enablement.
8. Bitcoin evaluator; Solana only after its wallet-proof rail.

## Explicit non-goals

- NFT collection counts or trait matching;
- fiat/price thresholds;
- negative balance rules;
- arbitrary unregistered tokens at runtime;
- provider names or RPC configuration in policy;
- permanent admission based on a one-time balance snapshot.
