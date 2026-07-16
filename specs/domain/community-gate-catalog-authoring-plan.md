# Community Gate Catalog Authoring Plan

Status: implementation in progress; lossless-array and owned-inventory stopgap shipped

Parent specification:

- [community-gate-builder.md](./community-gate-builder.md)

## Outcome

Moderators can author and edit Courtyard inventory gates from a trusted,
searchable catalog in the tree builder. The browser talks only to Pirate's API;
the API owns vendor adaptation, normalization, caching, and failure policy.
Existing policies containing string-array facet allowlists round-trip without
rewriting their meaning.

This plan covers the current `erc721_inventory_match` vocabulary. Generic NFT
trait snapshots, ERC-1155, new chains, and the generalized snapshot-match atom
remain outside this slice.

## Current gaps

- Production currently injects an owned-inventory stopgap implementation of
  `CollectionCapabilitySource`; the API-backed searchable catalog remains unbuilt.
- `searchFacetValues` is called only with an empty query; typed remote search,
  debounce, cancellation, and stale-response protection are absent.
- `probeContract` and `estimateMatchCount` exist in the interface but are not
  consumed by the builder.
- Typed remote search, debounce, pagination, and actionable retry states remain
  unbuilt. Loaded arrays are lossless, and unresolved sources now remain read-only.

## Non-negotiable invariants

1. No browser-to-Courtyard or browser-to-Algolia catalog requests. Vendor
   endpoints and credentials are replaceable backend details.
2. Save-time API validation remains authoritative. Capability responses are
   advisory and never make an otherwise-invalid policy valid.
3. Facet keys use Pirate's canonical vocabulary. Vendor field names never enter
   persisted gate policies.
4. Facet values are selected from trusted catalog results; free-form values stay
   forbidden.
5. A facet is represented as `string | string[]` end-to-end. Arrays preserve
   element boundaries, support 1–10 normalized-unique values, and never use
   comma joining as storage or identity.
6. Source failure cannot mutate the current rule. A loaded rule remains visible,
   lossless, and removable while catalog controls report unavailable.
7. Chain and registry allowlists are shared with authoritative gate validation,
   not duplicated in an adapter-specific table.

## Proposed API surface

The first executable capability contract contains only the two operations with
production builder consumers: trusted source listing and facet-value search.
The advisory contract probe and match estimate remain deferred until a rendered
consumer and acceptance test exist.

### Trusted sources

`GET /gate-capabilities/nft/sources`

Returns stable source ids and authoring capabilities:

```json
{
  "sources": [
    {
      "id": "courtyard-graded-cards-polygon",
      "label": "Courtyard graded cards",
      "chain_namespace": "eip155:137",
      "contract_address": "0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD",
      "standard": "erc721",
      "inventory_provider": "courtyard",
      "fixed_match": { "category": "trading_card" },
      "facet_keys": ["franchise", "subject", "set", "year", "grader", "grade"],
      "max_values_per_facet": 10,
      "min_quantity_supported": true
    }
  ]
}
```

Ethereum and Polygon registry entries are separate source records even when
their facet catalogs share an upstream collection. Source ids are stable Pirate
identifiers, not vendor index names.

### Facet values

`GET /gate-capabilities/nft/sources/{source_id}/facets/{facet_key}/values?q=char&cursor=...&limit=25`

```json
{
  "values": [
    { "value": "Charizard", "approximate_count": 412 }
  ],
  "next_cursor": null,
  "catalog_fetched_at": "2026-07-13T00:00:00Z"
}
```

The API validates source id, facet key, query length, cursor, and bounded page
size before calling the adapter. Results use canonical facet values and stable
pagination. Empty query returns the source's useful leading values; it must not
materialize the full graded-card dictionary.

All endpoint response types land in core/OpenAPI before API or web integration.
`probeContract` and `estimateMatchCount` should be removed from
`CollectionCapabilitySource` unless a product consumer is implemented before the
API-backed source lands.

## API implementation

1. Define a provider-neutral catalog adapter with operations matching source
   listing, facet search, and optional estimate.
2. Implement the Courtyard adapter server-side. Courtyard's supported catalog
   interface is preferred; the currently observed Algolia index may be an
   ingestion input but is not a public Pirate contract.
3. Normalize upstream collection/facet names into Pirate keys before caching.
   Normalization must share `normalizeInventoryText`, category rules, array
   uniqueness, and registry allowlists with gate validation.
4. Bound upstream work with timeout, pagination, query-length, page-size, and
   per-request result caps. Apply per-source cache keys and a documented TTL.
5. Serve a last-known-good cached dictionary during a short upstream outage only
   when its age is returned explicitly. With no usable cache, return a typed
   unavailable response; never return an empty success that looks like “no
   matches.”
6. Emit structured metrics for latency, cache hit/staleness, upstream status,
   normalization drops, rate limits, and unavailable responses. Do not log
   wallet addresses or raw credentials.

## Web implementation

1. Add an API-backed `CollectionCapabilitySource` and inject it from
   `community-gates-editor-page`. Keep Storybook's source as a fixture only.
2. Change match state and callbacks from `Record<string, string>` to
   `Record<string, string | string[]>`. Remove `stringifyFacetValue` from every
   edit path; it may remain display-only if it cannot feed serialized state.
3. Make `FacetValuePicker` a real multi-select capped by
   `maxValuesPerFacet <= 10`. Preserve loaded arrays exactly until the moderator
   changes that facet; changed values are normalized and deduplicated without
   comma joining.
4. Send the typed search query after a short debounce. Cancel obsolete requests
   or ignore stale responses by request generation. A query response for an old
   source/facet must never populate the current picker.
5. Give source list, facet search, and estimate independent loading, unavailable,
   empty, and retry states. Rejection handlers are mandatory; no floating promise
   may produce an unhandled rejection.
6. Use or delete `probeContract` and `estimateMatchCount`. The production
   interface contains only methods with a rendered consumer and acceptance test.
7. Preserve read-only rendering for loaded Courtyard rules whenever capability
   data is unavailable.

## Verification matrix

### Core and API

- OpenAPI schemas cover sources, probe, paginated facet values, typed unavailable
  responses, and optional estimates.
- Adapter contract tests cover normalization, pagination, cache freshness,
  timeout, rate limit, malformed upstream data, and last-known-good behavior.
- Route tests prove unknown source/facet rejection and that save validation still
  rejects forged capability-derived policies.
- A real upstream fixture proves at least one graded-card and one watch mapping
  without committing vendor credentials.

### Web

- `parse -> edit elsewhere -> serialize` preserves scalar and array matches.
- Selecting one value serializes a scalar; selecting two or more serializes an
  array.
- `"Charizard,Gengar"` and `["Charizard", "Gengar"]` remain distinct.
- Removing the final required card/watch identifier blocks save with the inline
  completeness error.
- Source rejection renders unavailable/retry and preserves the current atom.
- Debounce and stale-response tests prove old queries cannot overwrite new ones.
- Desktop and mobile rendered tests cover long chips, ten selected values,
  loading, unavailable, and empty results.

### Staging

- Authenticated moderator can select a source, author scalar and multi-value
  filters, save, reload, and observe an identical policy.
- Existing admin-authored Courtyard rules load without mutation and can be edited
  without array loss.
- Membership evaluation succeeds for a known matching wallet and fails closed for
  a non-match and provider outage.

## Delivery sequence

1. Core/OpenAPI contract PR.
2. API adapter and capability routes behind authenticated moderator access.
3. Web lossless-array model and API source implementation behind
   `VITE_GATE_TREE_BUILDER_ENABLED`.
4. Staging deploy with adapter metrics and authenticated save/reload verification.
5. Failure-mode exercise: upstream timeout, stale cache, invalid source, and
   empty search.
6. Production merge remains flag-off. Enable only after the staging evidence and
   localization of validation/source errors are complete.

## Completion criteria

This slice is complete only when every verification item above has evidence and:

- no production code path uses the Storybook capability fixture;
- no editor state conversion joins arrays into strings;
- every `CollectionCapabilitySource` method has a production consumer or is
  removed;
- the browser performs no direct Courtyard/Algolia catalog request;
- a multi-value Courtyard policy survives author, save, reload, and unrelated
  edits byte-for-byte or canonically equivalent without semantic change;
- source outage preserves the draft and produces an actionable retry state; and
- production remains flag-off until the authenticated staging release gate passes.
