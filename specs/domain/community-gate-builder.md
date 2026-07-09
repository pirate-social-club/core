# Community Gate Builder

Status: draft (2026-07-09) — direction agreed in design review; not yet implemented

Related docs:

- [community.md](./community.md)
- [community-tiers-entitlements.md](./community-tiers-entitlements.md)
- [identity-presentation.md](./identity-presentation.md)
- [handles.md](./handles.md)

## Purpose

Authoring model and serialization contract for community gate policies
(`community_gate_policies.expression_json`). Replaces the flat draft editor
with a boolean query builder that can author and round-trip the full backend
expression model. Concept validated in web Storybook (`BooleanQueryBuilder`
story, web branch `feat/gate-editor-boolean-builder`).

This spec covers eligibility authoring only. Mapping gate outcomes to
entitlements (tiers, name claims, badges) is
[community-tiers-entitlements.md](./community-tiers-entitlements.md).

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

The current editor is a flat draft list with a global match mode; it cannot
represent trees. That editor and its advanced-policy preserve banner are
superseded by this spec.

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
- Assurance-dilution warnings are concrete and inline: an OR group containing
  `altcha_pow` plus stronger proofs states that completing the anti-bot check
  alone grants passage.

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

The backend keeps a trust registry:

```
collection → supported evaluation modes → trusted trait source → freshness/staleness policy
```

Serialization routing:

- no trait filter → `erc721_holding`
- trait filter, trusted source = courtyard → `erc721_inventory_match`
- trait filter, future sources (Reservoir / Alchemy / OpenSea /
  project-hosted) → generalized inventory atom or a new provider-backed
  strategy (open)

Provenance appears as small copy ("Traits verified via Courtyard"), never as
a primary field. Known backend gaps surfaced honestly in the UI until fixed:
`erc721_holding` has no min-count (quantity locked at 1), is mainnet-only,
and there is no ERC-1155 support.

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
   facet predicate. Courtyard research on 2026-07-09 found:
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
  freshness policy.
- General NFT indexer selection for non-Courtyard trait gating.
- ERC-1155 and additional chains as new evaluation modes.
- ZKPassport → `unique_human` promotion. Gated on: (a) nullifier semantics
  check (per-document, app-scoped), (b) evidence of real-document completions
  in prod, (c) staging e2e with `ZKPASSPORT_DEV_MODE`. Decides the Personhood
  chip set here, retroactive backfill, and the verified-badge population.
- Fungible/native balance gates: new atom family, out of scope for this spec
  (ETH/ERC-20 first; BTC/SOL blocked on wallet-attachment rails; USD
  denomination requires an oracle policy).

## Non-goals

- NOT/negation and range predicates (backend vocabulary change; out of scope).
- Tiers, name claims, badges, renewal — see
  [community-tiers-entitlements.md](./community-tiers-entitlements.md).
