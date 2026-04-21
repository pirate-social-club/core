# Courtyard Inventory Gate Source Spike

Status: limited-use implementation exists for Courtyard Polygon inventory gates. A public owner-to-asset facts path has been found and wired fail-closed, but Courtyard API stability and rate-limit guarantees are still not verified.

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

Before broad production rollout, verify one of:

1. Courtyard confirms `GET /index/ownership` or another endpoint is official enough for server-side eligibility enforcement, including rate limits and auth expectations.
2. Courtyard provides signed metadata or another verifiable token-to-asset fact source.
3. Pirate builds an audited curated catalog keyed by `{ chain_namespace, contract_address, token_id }`.

Raw ERC-721 `balanceOf` and untrusted display metadata are not enough for `3 Charizards` or `5 Rolexes`.

## Catalog-Backed Authoring Requirement

The community creator and moderation UI must not accept freeform Courtyard asset text for production gate authoring. Values such as `brand`, `model`, `franchise`, `subject`, `set`, `year`, `grader`, `grade`, and `reference` must come from a Pirate backend catalog derived from an authoritative Courtyard source.

The correct authoring path is:

1. Ingest Courtyard assets from an official Courtyard API, partner export, signed metadata feed, or audited Pirate catalog source.
2. Store normalized token facts keyed by `{ chain_namespace, contract_address, token_id }`, including source provenance and `last_seen_at`.
3. Derive selectable facets from stored facts, not from frontend constants:
   - category
   - franchise / sport / brand
   - subject / player / model / reference
   - set / year / grader / grade / condition where available
4. Expose Pirate-owned catalog endpoints for the UI:
   - `GET /courtyard/catalog/categories`
   - `GET /courtyard/catalog/facets?category=...`
   - `GET /courtyard/catalog/search?category=...&q=...`
   - `GET /courtyard/catalog/options?...`
5. Store gate configs using catalog-selected normalized values or stable catalog option IDs. Do not let the client submit arbitrary matching strings as if they were verified catalog facets.
6. Evaluate membership with the same normalized catalog facts used by the authoring UI. The evaluator and UI must not maintain separate string heuristics.

Until that catalog exists, Courtyard gate authoring should remain unavailable in user-facing UI. Backend evaluation can remain fail-closed for controlled/internal gates, but creators should not be asked to type `Rolex`, `Submariner`, `Pokemon`, or `Charizard` into raw text fields.

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

## Implemented Integration Contract

The current `erc721_inventory_match` implementation depends on this observed `/index/ownership` response shape:

- `chain` is `polygon`, mapped to `eip155:137`
- `contract` is the allowlisted Courtyard Polygon registry
- `token_id` identifies the ERC-721 token
- `owner.address` is the owner returned by the endpoint
- card/watch categorization is inferred from `collection`, `title`, and card grading attributes
- card filters use `Category` as franchise and `Title/Subject` or `Title/PKMN` as subject
- watch filters use `Brand` and `Model` or `Reference`

Matching semantics are intentionally mixed:

- `franchise` and `brand` are exact normalized matches
- `subject` and `model` are normalized contains matches, so values like `Charizard` and `Submariner` match graded or variant titles

The evaluator now:

- queries only linked Polygon wallets (`eip155:137`)
- deduplicates matches by `{ chain_namespace, contract_address, token_id }`
- follows Courtyard pagination until `total` is reached
- caches successful match counts briefly, defaulting to 60 seconds
- does not cache provider failures
- returns `token_inventory_unavailable` when the provider throws or returns an error

Runtime overrides:

```txt
COURTYARD_API_URL
COURTYARD_INVENTORY_CACHE_TTL_MS
```

`COURTYARD_INVENTORY_CACHE_TTL_MS` defaults to `60000`, accepts `0` to disable, and is capped at five minutes.

## Known V0 Constraints

- All gate rules are ANDed. The UI supports one Courtyard inventory gate at a time; `3 Charizards OR 5 Rolexes` needs a later gate grouping/operator model.
- The normalization layer is coupled to Courtyard's current attribute names. CI has schema-drift tests for unknown category handling, but Courtyard can still break matching if they rename core fields without notice.
- The endpoint still needs an explicit stability/rate-limit confirmation from Courtyard or a Pirate-maintained signed/catalog source before broad rollout.
