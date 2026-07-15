# Community Gate Builder

Status: generic builder implemented and staging-verified; production flag off;
catalog-backed trait authoring deferred

Related docs:

- [community.md](./community.md)
- [community-gate-catalog-authoring-plan.md](./community-gate-catalog-authoring-plan.md)
- [community-tiers-entitlements.md](./community-tiers-entitlements.md)
- [identity-presentation.md](./identity-presentation.md)
- [handles.md](./handles.md)

## Purpose

Authoring model and serialization contract for community gate policies
(`community_gate_policies.expression_json`). Replaces the flat draft editor
with a boolean query builder that can author and round-trip the full backend
expression model. The generic builder is implemented in web; its original
Storybook prototype is retained as design and acceptance coverage.

This spec covers eligibility authoring only. Mapping gate outcomes to
entitlements (tiers, name claims, badges) is
[community-tiers-entitlements.md](./community-tiers-entitlements.md).

## Implementation status

- The generic boolean tree builder is implemented on web `main`, including
  nested AND/OR groups, canonical serialization, full current-atom client
  validation, localized validation/source errors, live policy summary, and
  preservation of atoms unknown to the current web build.
- The builder is enabled in staging builds and was verified through an
  authenticated moderator create/save/reload flow against the real staging
  API on 2026-07-15. The persisted canonical nested policy matched the
  authored tree, invalid atoms blocked save with an inline error, and desktop
  and mobile layouts passed overflow checks.
- Production remains on the legacy editor because
  `VITE_GATE_TREE_BUILDER_ENABLED` is intentionally absent from the
  production build. Enabling it is a separate rollout decision.
- Catalog-backed collection and trait authoring is not implemented. The web
  application does not yet wire a real collection capability source, so the
  Courtyard card/watch catalog flow remains Storybook-only and existing
  inventory-match rules are read-only. The related
  [catalog authoring plan](./community-gate-catalog-authoring-plan.md) remains
  the implementation contract for that work.

## Background: the backend model (already live)

- `expression_json` = recursive tree: `{op: and|or, children[]}` |
  `{op: gate, gate: atom}`. Version 1.
- Limits: depth ≤ 4, ≤ 20 atoms total, ≤ 20 children per node.
- Exactly one predicate per atom type. No NOT, no ranges.
- Atom types: `unique_human` (single provider `self|very`), `minimum_age` /
  `nationality` / `gender` (document atoms, `accepted_providers ⊆
  {self, zkpassport}`), `wallet_score`, `erc721_holding` (mainnet balanceOf),
  `erc721_inventory_match` (Courtyard trait match), `altcha_pow`.
- Evaluation returns a per-branch trace and required-action set; enforce mode
  short-circuits, preview mode evaluates all children.

The legacy production editor is a flat draft list with a global match mode;
it cannot represent trees. The implemented tree builder supersedes that
editor when the feature flag is enabled; until then, the legacy editor and
its advanced-policy preserve banner remain the production path.

## Builder grammar

- Every leaf is a row: `[field ▾] [check] [value editors] [×]`.
- Every group is a bordered region: `[AND/OR ▾] [+ Rule] [+ Group] [×]`,
  nested groups tinted by depth. The root group is not removable.
- The check column is fixed per field (backend defines one predicate per
  atom). Render it as a static token, not a fake dropdown.
- Repeated field types are allowed anywhere (two NFT rows in one OR).
- Values are always edited inline (numeric score/age inputs, country
  combobox with popover results, provider chips).
- Empty root shows example chips ("Humans only", "Stop spam", "NFT club",
  ...). Examples are stamp-and-forget pre-authored trees — no wizard screen,
  no persistent template linkage. Examples are defined as data
  (`{name, description, tree}` fixtures) and double as round-trip test corpus
  and Storybook acceptance stories.
- A live plain-English summary renders the tree. The summary describes saved
  policy meaning ONLY; validation errors render on rows and in a separate
  "fix before saving" list, never inside the summary.
- The serialized atom/depth budget is displayed live and computed on the
  SERIALIZED form, not the visual tree (a two-provider personhood row
  serializes to an OR of two `unique_human` atoms).
- Assurance-dilution warnings are SEMANTIC, not structural. The strong
  warning ("a browser challenge alone is enough to join") fires only when the
  WHOLE policy evaluates true under the assignment "`altcha_pow` satisfied,
  every other atom false". An anti-bot OR nested inside a stronger AND —
  e.g. `human AND (anti-bot OR score)` — must not warn as if the captcha
  admits anyone; it gets milder easiest-path-through-this-group copy, since
  the enclosing conjunction still gates admission. A structural per-group
  check is locally true but globally misleading.
- The builder does not include a hypothetical-member or "who gets in"
  simulator. In practice this duplicated the live rule summary while adding
  controls (for example, a zero-valued asset quantity) that did not help an
  admin author the policy. Admission behavior remains covered by policy
  evaluation tests rather than an interactive authoring-panel preview.

## Field vocabulary → atom mapping

| Field (admin-facing)  | Check            | Serializes to |
| --------------------- | ---------------- | ------------- |
| Human verification    | proven via any of | `unique_human` per selected provider; >1 providers → `or(...)`. Provider set is `self|very` today; ZKPassport joins ONLY if promoted backend-side (open decision, see below) |
| Nationality           | is one of        | `nationality` with `allowed[]` + explicit `accepted_providers` |
| Minimum age           | ≥                | `minimum_age` (18–125) + explicit `accepted_providers` |
| Sex marker            | is               | `gender` with `allowed: [F|M]` + explicit `accepted_providers` |
| NFT holding           | holds ≥          | `erc721_holding` or `erc721_inventory_match` (see unified NFT rule) |
| Passport score        | ≥                | `wallet_score` (0–100) |
| Browser anti-bot      | solved at join   | `altcha_pow` |

Document rows carry their provider set (`self` / `zkpassport` chips) inline;
personhood rows carry `self` / `very` chips. The two vocabularies are
distinct and must never share state.

### Identity provider extensibility

Personhood and document providers will keep arriving (World ID is
anticipated; ZKPassport personhood promotion is deferred until it can be
exercised with real documents). Design constraint: adding a provider must
not reshape atoms or the editor.

- **Provider registry (data, not code):** per-provider record — id, kind
  (personhood | document | reputation), capabilities minted, nullifier scope
  (per-body | per-document | per-app), assurance levels, expiry policy,
  enabled. Atom validation checks provider ids against the registry instead
  of hardcoded enums; editor provider chips derive from kind + enabled. The
  current hardcoded vocabularies (atom validation enums, the
  `users.capability_provider` CHECK constraint, `identity_nullifiers`
  provider/mechanism values) migrate to registry-validated values.
- **What stays code:** proof verification and session flows are inherently
  per-provider (SDKs, proof formats, containers). The registry governs only
  vocabulary, display, and acceptance.
- **Capabilities remain the seam:** providers mint capabilities plus
  nullifiers; gates consume capabilities. A new personhood provider = a new
  verification flow + a registry row; zero atom schema changes.
- **Assurance levels:** providers may carry levels (World ID Orb vs Device).
  The registry records levels from day one; whether `unique_human` gains an
  optional minimum-level field is decided when the first multi-level
  provider lands.
- **Sybil floor:** a personhood rule accepting multiple providers is exactly
  as sybil-resistant as its WEAKEST accepted provider (per-document
  nullifiers admit one identity per passport; per-body scopes admit one per
  person). Editor copy should surface this when accepted providers diverge
  in scope.

## Serializer contract

- The draft model is a tree mirroring `GateExpression`; the flat
  `IdentityGateDraft[]` + match-mode model is retired.
- Canonicalization on serialize: flatten same-op nesting
  (`or(a, or(b,c))` → `or(a,b,c)`), collapse single-child op nodes, drop
  empty groups. Required to conserve the depth-4 budget, since rows expand to
  multiple atoms.
- `accepted_providers` is always serialized explicitly (an absent field
  defaults to `["self"]` at eval time — never rely on the default).
- Round-trip fidelity is a hard requirement: `parse(serialize(tree))` must be
  canonically equal, for every atom type. Round-trip tests land BEFORE any
  builder UI (the previous editor shipped a silent policy-flattening bug that
  serialize-only tests could not catch).
- Load is full-fidelity: any valid stored policy renders in the builder.
  This retires the advanced-policy banner / preserve-on-load / replacement-
  consent machinery and the `cross_group_or` "advanced" classification.

## Unified NFT rule

The admin-facing concept is one field:

```
NFT holding
holds ≥ [qty] from [collection]
optional: + Add trait filter
```

There is NO visible source/provider selector. The distinction that matters is
collection-level vs trait-level predicates:

- Collection-level ("any token from this contract") evaluates by direct RPC
  (`balanceOf`).
- Trait-level ("a token matching subject=Charizard") requires a trusted
  metadata source. NFT metadata is generally mutable and indexer-dependent —
  this is not a Courtyard property; on-chain collections have mutable traits
  too.

The backend keeps a trust registry — one record per gated collection:

```
{
  chain_namespace, contract_address,
  standard: erc721 | erc1155 | cryptopunks,
  evaluation_modes: [collection_holding, trait_match],
  trait_source: {kind: owned_snapshot, ingestion_vendor}
              | {kind: live_api, provider: courtyard},
  freshness: {refresh_interval, on_trait_diff: alert | accept | freeze},
  current_trait_table_version
}
```

### Owned trait store + propose/confirm evaluation

For generic collections, trait data is OWNED, not queried live. Third-party
NFT APIs are ingestion and proposal inputs to the adapter, never the live
gate-evaluation path. Rationale: the standalone NFT-indexing market is
unstable — Reservoir sunset its NFT API in 2025 (pivoting to Relay) and
SimpleHash shut down 2025-03-27 after the Phantom acquisition. A vendor's
death must be an inconvenience (re-point the crawler), not a gate outage.

- **Ingest:** provider-assisted crawl (or raw RPC + `tokenURI` fetches) →
  `chain + contract + token_id → normalized traits` in our storage, stamped
  with `trait_table_version`, `source`, `fetched_at`. Feasible because trait
  gates exist only for registry collections (BAYC = 10k rows), never "all
  NFTs".
- **Normalize once, at ingestion:** vendor facet names map to canonical
  match keys. One normalization concept covers Courtyard/Algolia facets and
  generic vendor attributes.
- **Refresh:** scheduled per the registry freshness policy. Each refresh
  computes a trait DIFF against the prior version — a changed trait silently
  changes who is eligible (reveals, `baseURI` swaps) — and the registry's
  `on_trait_diff` policy decides: alert, accept, or freeze the collection's
  trait gates pending review.
- **Evaluate (propose/confirm):** a vendor ownership endpoint (or our own
  owner index) PROPOSES candidate token ids owned by the wallet; candidates
  join against our trait snapshot; the granting token(s) are CONFIRMED
  on-chain before admission — `ownerOf(tokenId)` for ERC-721,
  `balanceOf(wallet, tokenId)` for ERC-1155, the native
  `punkIndexToAddress` path if CryptoPunks is ever onboarded. A stale or
  lying proposal can never falsely grant; proposal-source downtime fails
  closed; confirm cost is one RPC call per granting token.
- **Vendor-free evaluation (later):** the crawler can additionally maintain
  a per-collection owner index (scheduled `ownerOf`/multicall sweeps or
  Transfer-log tailing), making proposal a local query and demoting vendors
  to ingestion bootstrap only.
- **ERC-1155 quantity semantics (decide before 1155 ships):** `holds ≥ N`
  means total matching balance across token ids, not N distinct token ids.

Courtyard remains a live-API source deliberately: its traits and custody
state describe physical vaulted assets that change off-chain (redemption),
so Courtyard is the authority of record, not an indexer. Its path is already
hardened (allowlist, timeout, cache, pagination cap).

Serialization routing:

- no trait filter → `erc721_holding` with optional `min_count` (default 1)
- trait filter, `trait_source.kind = live_api` (Courtyard) →
  `erc721_inventory_match`
- trait filter, `trait_source.kind = owned_snapshot` → a generalized
  snapshot-match atom (new; shape open — carries the collection plus the
  canonical trait predicate, evaluated against the owned store)

For `erc721_inventory_match`, `match` is a flat record: keys are ANDed
together, and each key's value may be either one string or a non-empty
allowlist of strings. An allowlist ORs within that facet, so
`{subject: ["Charizard", "Gengar"]}` means either subject qualifies. The
`min_quantity` threshold counts assets matching the whole predicate: `holds ≥
2` with `subject: ["Charizard", "Gengar"]` may be satisfied by one Charizard
and one Gengar.

Known backend gaps are surfaced honestly in the UI until fixed:
`erc721_holding` is mainnet-only, and there is no ERC-1155 support.

## Capability probe (advisory)

The builder needs to know, per collection, whether trait filters are
available. This is a separate interactive endpoint, NOT bolted onto save-time
validation:

```
GET /gate-capabilities/nft?chain=eip155:1&contract=0x...

{
  "is_erc721": true,
  "collection_level_supported": true,
  "trait_filters_supported": true,
  "trait_source": "courtyard",
  "facet_keys": ["category", "franchise", "subject", "grade"],
  "min_quantity_supported": true
}
```

- Advisory and cached. Reuses the backend validation logic (ERC-165 probe,
  trust registry lookup) but is a distinct surface.
- Save-time validation re-checks everything authoritatively. The serializer
  must not trust probe results.
- When traits are unsupported, the editor states WHY (no trusted metadata
  source for this collection) — not a bare "unavailable".

## Trait-filter authoring paths

1. **Catalog/trait search (primary):** pick collection → search
   trait namespace/value (subject = Charizard) → optionally narrow
   (grade/set/year) → preview approximate matched class → serialize the exact
   facet predicate. For collections with an owned snapshot, the facet
   dictionary and class-size preview are served from OUR trait store —
   vendor catalogs (Alchemy `summarizeNFTAttributes`, OpenSea collection
   traits, Courtyard's Algolia index) are pre-onboarding evidence, ingestion
   inputs, and cross-checks for the adapter, not the authoring backend and
   never the committed production contract. Courtyard ingestion-bootstrap
   research on 2026-07-09 found:
   - `/index/query` is no longer a viable general catalog path (HTTP 410).
   - `/index/attributes?collection=Watches` and
     `/index/attributes?collection=Graded%20Cards` expose catalog-level facet
     dictionaries independent of the creator's wallet. `Graded Cards` is very
     large and should be fetched/cached server-side, not directly from the UI.
   - Courtyard's current frontend uses a public Algolia catalog index
     (`marketplace_prod_asset_ownership`) that supports text search
     (`query=Charizard`) and returns facet counts such as
     `metadata.Category`, `metadata.Title/Subject`, `metadata.Set`, and
     `metadata.Grade`. This is the likely source for interactive trait search
     and approximate class-size preview.
   Production work still needs a backend adapter, caching/staleness policy,
   and normalization from Courtyard/Algolia facet names to Pirate's canonical
   `erc721_inventory_match.match` keys.
2. **Inventory-derived shortcut:** "start from an asset I own" — populate a
   facet predicate from the creator's connected-wallet holdings. Useful,
   guaranteed-valid facets, but a labeled stopgap: admins gate on assets they
   do not personally hold. Never the primary path.
3. **Free-form facet entry: forbidden.** A typo'd facet creates a fail-closed
   gate nobody can ever pass.

## Open decisions

- Courtyard catalog/search adapter shape: Algolia-backed search plus
  `/index/attributes` fallback/cache, facet normalization, rate limits, and
  freshness policy. These are ingestion inputs to the adapter, not committed
  production contracts — pursue a Courtyard-supported catalog path for
  durability.
- Ingestion/proposal vendor bake-off for generic collections. Alchemy is the
  default candidate (`summarizeNFTAttributes` for facet dictionaries,
  ownership endpoints for crawl/propose); alternates: Moralis, QuickNode,
  OpenSea, NFTScan. Criteria: CryptoPunks normalization, ERC-1155 handling,
  post-reveal refresh behavior, rate limits, price. Vendors are replaceable
  by design (owned snapshot).
- Shape of the generalized snapshot-match atom. Recommended: a flat match
  record mirroring the Courtyard atom — keys ANDed, per-key value allowlists
  OR'd (the `nationality.allowed[]` precedent). Boolean composition beyond
  that belongs to the expression tree, not a nested predicate language
  inside the atom. Gates evaluate against the CURRENT trait snapshot; version
  pinning lives in tier provenance (evidence), never in policy.
- ERC-1155 and additional chains as new evaluation modes.
- ZKPassport → `unique_human` promotion. Today the API stores ZKPassport
  completions as document capabilities only; it records the
  `zkpassport-unique-identifier` nullifier but does not mint `unique_human` or
  set the user's global `verification_state`. Production aggregate read on
  2026-07-09 found 0 ZKPassport sessions, attestations, or active
  nullifiers, so there is no current backfill population. Promotion is still
  gated on: (a) final nullifier semantics check (per-document, app-scoped),
  (b) staging e2e with `ZKPASSPORT_DEV_MODE`, and (c) the product decision
  that passport-NFC uniqueness should count as personhood. This decides the
  Personhood chip set here and the verified-badge population.
- Fungible/native balance gates: new atom family, out of scope for this spec
  (ETH/ERC-20 first; BTC/SOL blocked on wallet-attachment rails; USD
  denomination requires an oracle policy).

## Non-goals

- NOT/negation and range predicates (backend vocabulary change; out of scope).
- Tiers, name claims, badges, renewal — see
  [community-tiers-entitlements.md](./community-tiers-entitlements.md).
