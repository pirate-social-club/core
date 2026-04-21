# Courtyard Inventory Gate Source Spike

Status: phase-zero checkpoint partially passed. A public owner-to-asset facts path has been found, but API support/stability and final contract allowlisting are not verified.

## Goal

Prove that Pirate can securely answer:

```txt
wallet address -> owned Courtyard token IDs -> authoritative asset facts
```

Minimum required asset facts for v1:

```ts
{
  tokenId: string;
  category: "trading_card" | "watch";
  franchise?: string;
  subject?: string;
  brand?: string;
  model?: string;
}
```

## Current Finding

Public Courtyard docs confirm a mainnet Courtyard Registry ERC-721 contract at:

```txt
0xd4ac3CE8e1E14CD60666D49AC34Ff2d2937cF6FA
```

They also describe the physical-asset identity model: Courtyard token IDs correspond to Proof of Integrity values derived from human-readable fingerprints. That supports the product concept, but it does not by itself expose an owner-inventory API suitable for enforcement.

The current Courtyard web app exposes:

```txt
https://courtyard.io/api/config -> courtyardApiUrl: https://api.courtyard.io
```

The public API currently responds to:

```txt
GET https://api.courtyard.io/index/ownership?owner=<wallet>&walletType=both&offset=0&limit=<n>
```

That endpoint returns owned assets with:

- `token_id`
- `contract`
- `chain`
- `owner.address`
- `collection`
- `attributes[]`, including values such as `Category`, `Title/Subject`, `Title/PKMN`, `Grader`, `Grade`, `Year`, and `Set`

Important mismatch: sampled current app data uses `chain: "polygon"` and contract `0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD`, while earlier documentation references an Ethereum mainnet registry. The implementation must not assume `eip155:1` for Courtyard without confirming which contracts/chains are authoritative for the target assets.

Additional sampled read paths:

```txt
GET https://api.courtyard.io/index/query?collection=Graded%20Cards&offset=0&limit=2
GET https://api.courtyard.io/index/query?collection=Watches&offset=0&limit=14
```

The `Graded Cards` query returned Pokemon card facts including `Category: Pokémon` and `Title/Subject`. The wallet ownership proof also sampled a public owner with `subject: "Charizard V"`.

The `Watches` query returned watch facts including `Category: Watches`, `Brand`, `Reference`, `Condition`, and watch titles. Sampled Rolex titles included `Rolex GMT 40mm`, `Rolex Yacht-Master Blue Dial`, `Rolex Oyster Perpetual 41mm Green Dial`, `Rolex Air-King`, and `Rolex Submariner No Date`.

## Audit Gate

Before backend schema or enforcement changes, verify one of:

1. Courtyard confirms `GET /index/ownership` or another endpoint is official enough for server-side eligibility enforcement, including rate limits and auth expectations.
2. Courtyard provides signed metadata or another verifiable token-to-asset fact source.
3. Pirate builds an audited curated catalog keyed by `{ chain_namespace, contract_address, token_id }`.

Raw ERC-721 `balanceOf` and untrusted display metadata are not enough for `3 Charizards` or `5 Rolexes`.

## Spike Script

The source discovery script lives in:

```txt
pirate-api/services/api/scripts/spike-courtyard-inventory-source.ts
```

Run public bundle discovery:

```bash
rtk bun run spike:courtyard-inventory-source
```

Run endpoint proof when an authoritative candidate is known:

```bash
rtk bun run spike:courtyard-inventory-source --endpoint <url> --wallet <known-owner> --token-id <known-token-id>
```

The endpoint proof must return `verified: true`. The script currently requires at least one returned token object with `tokenId` and `category` fields. Expand that assertion once Courtyard's actual response schema is known.

Run the built-in Courtyard ownership proof path:

```bash
rtk bun run spike:courtyard-inventory-source --wallet <known-courtyard-owner> --limit 5
```

This calls `/index/ownership` and normalizes sampled assets into:

```ts
{
  tokenId: string;
  assetClass: "trading_card" | "watch" | "unknown";
  category: string | null;
  franchise: string | null;
  subject: string | null;
  brand: string | null;
  model: string | null;
  ownerAddress: string;
  contractAddress: string;
  chain: string | null;
}
```

## Pass Criteria

- The source returns owned token IDs for a known wallet. Current result: passed with `/index/ownership`.
- The source returns asset facts sufficient to distinguish `Pokemon Charizard` from other cards. Current result: passed for sampled card data via `Category` + `Title/Subject` or `Title/PKMN`.
- The source returns asset facts sufficient to distinguish `Rolex` from other watches. Current result: passed for sampled `Watches` collection data via `Brand: Rolex`.
- Ownership is tied to the requested wallet and Courtyard registry contract.
- Failure modes are distinguishable from "user does not own enough matching assets."
- Courtyard confirms the endpoint is stable and acceptable for server-side eligibility checks.
- The authoritative chain/contract allowlist is resolved. Current sampled app data points to Polygon, not only the Ethereum registry.

## Implementation Hold

Until the remaining pass criteria are met, do not add product-facing UI for Courtyard collectible gates and do not add join enforcement for `erc721_inventory_match`.
