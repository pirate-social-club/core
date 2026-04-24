# Royalty Graph

Status: current working spec

Related docs:

- [post.md](./post.md)
- [asset.md](./asset.md)
- [marketplace.md](./marketplace.md)
- [monetization.md](./monetization.md)
- [donations.md](./donations.md)
- [rights-review.md](./rights-review.md)

## Purpose

This doc defines how Pirate models upstream relationships that may affect attribution, derivative lineage, and money flow.

It covers:

- royalty-graph identity
- graph nodes and edges
- legal versus social edge strength
- Story-native versus Pirate-native enforcement
- how the royalty graph relates to payout routing

## Non-goals

This doc does not define:

- every Story Protocol contract call
- the full legal validity of every user-declared relationship
- exact subgraph/indexer schemas
- final dispute resolution workflow

## Core Principle

The royalty graph is broader than Story.

Story-native derivative and royalty relationships are one important subset, but Pirate must also support softer club-defined attribution relationships that do not automatically imply enforceable royalty payment.

So the graph must represent:

- hard legal or protocol-native edges
- softer club attribution edges
- payment-relevant versus non-payment-relevant edges

## Canonical Object

Recommended v0 model:

- one `royalty_graph` per asset when needed
- the graph is attached to the downstream asset
- graph identity is app-issued and stable even if some external Story details are corrected later

Suggested v0 fields for `royalty_graphs`:

- `royalty_graph_id`
- `root_asset_id`
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `root_asset_id`
  The downstream asset whose lineage and payout obligations this graph primarily describes
- `status`
  - `draft`
  - `active`
  - `disputed`
  - `frozen`

## Graph Nodes

Recommended v0 rule:

- assets are the only first-class royalty-graph nodes

Suggested v0 shape:

- `royalty_graph_nodes`
  - `royalty_graph_node_id`
  - `royalty_graph_id`
  - `asset_id`
  - `story_ip_id` nullable
  - `created_at`

Rules:

- each node must reference exactly one asset
- `story_ip_id` is attached when the asset has been published to Story
- raw posts do not attach directly to royalty graphs

## Graph Edges

Edges describe how one downstream asset relates to one upstream asset.

Suggested v0 shape:

- `royalty_graph_edges`
  - `royalty_graph_edge_id`
  - `royalty_graph_id`
  - `downstream_asset_id`
  - `upstream_asset_id`
  - `edge_class`
  - `settlement_source`
  - `enforcement_mode`
  - `share_pct` nullable
  - `edge_source`
  - `status`
  - `created_at`
  - `updated_at`

Suggested meanings:

- `edge_class`
  - `licensed_derivative`
  - `protocol_derivative`
  - `attribution_only`
  - `reference_only`
- `settlement_source`
  - `story_native`
  - `pirate_policy`
  - `none`
- `enforcement_mode`
  - `passthrough`
  - `club_optional`
  - `none`
- `share_pct`
  Optional edge-specific share when Pirate policy, not Story, defines the upstream share
- `edge_source`
  - `story_registration`
  - `asset_reference`
  - `manual_review`
  - `analysis_suggestion`
- `status`
  - `pending`
  - `accepted`
  - `rejected`
  - `revoked`

## Edge Class Semantics

### `licensed_derivative`

Use when:

- the downstream asset is intentionally using an upstream work
- the rights path supports commerce and royalty routing
- there is a recognized derivative relationship even if Story is not the only source of truth

Usual effect:

- payment-relevant
- often `enforcement_mode = passthrough`

### `protocol_derivative`

Use when:

- Story is the source of truth for the derivative relationship
- the downstream asset's obligations should follow Story-native royalty behavior

Usual effect:

- payment-relevant
- `settlement_source = story_native`
- `enforcement_mode = passthrough`

### `attribution_only`

Use when:

- the creator wants to acknowledge influence or share proceeds socially
- Pirate should support club-defined revenue sharing without overclaiming strong legal enforceability

Usual effect:

- may be money-relevant
- usually `settlement_source = pirate_policy`
- often `enforcement_mode = club_optional`

### `reference_only`

Use when:

- the relationship is metadata or discovery context only
- no payout obligation should be inferred

Usual effect:

- not payment-relevant
- `settlement_source = none`
- `enforcement_mode = none`

## Story vs Pirate Responsibility

The graph may mix Story-native and Pirate-native meaning, but it must be clear which layer is authoritative for each edge.

Rules:

- if Story is the source of truth for an edge, Pirate should not contradict it locally
- Pirate may add softer attribution or reference edges on top of Story
- Pirate-only edges must not be misrepresented as Story-enforced obligations

Practical interpretation:

- Story-native edges are authoritative for protocol royalty passthrough
- Pirate-native edges are authoritative only for Pirate product behavior and payout policy

## Relationship To Asset Derivative Links

`asset_derivative_links` remain useful as the immediate per-asset reference model.

The royalty graph is the normalized payout/lineage model built from accepted derivative links and Story-native relationships.

Recommended v0 interpretation:

- derivative links are local asset references
- royalty-graph edges are the accepted and classified subset that matter for lineage and money flow

This keeps upload/reference UX simpler while letting Pirate apply stricter review before an edge becomes payout-relevant.

## Relationship To Rights Basis

`rights_basis` is declared on the post and copied onto the asset.

The royalty graph does not replace that declaration.

Instead:

- `rights_basis` expresses creator intent
- derivative links capture candidate upstream references
- royalty-graph edges capture accepted lineage and payout meaning

Examples:

- `rights_basis = derivative`
  usually implies at least one royalty-graph edge should eventually exist
- `rights_basis = attribution_only`
  may produce `attribution_only` edges
- `rights_basis = original`
  normally implies no upstream royalty edge unless later review determines otherwise

## Relationship To Monetization

The payout waterfall is defined in [monetization.md](./monetization.md).

The royalty graph answers the upstream question that monetization needs:

- does an upstream obligation exist
- where does that obligation come from
- is it required or optional

Mapping guidance:

- `protocol_derivative` or `licensed_derivative` with `enforcement_mode = passthrough`
  usually maps to `upstream_royalty_mode = passthrough`
- `attribution_only` with `enforcement_mode = club_optional`
  usually maps to `upstream_royalty_mode = club_optional`
- `reference_only`
  maps to `upstream_royalty_mode = none`

Donation sidecars do not alter this mapping.

Rules:

- creator-side donation is resolved after required or optional upstream royalty handling
- donation must not reduce obligations implied by accepted royalty-graph edges

## Relationship To Marketplace

Marketplace sellability depends in part on royalty-graph state.

Recommended v0 rules:

- an asset with unresolved required upstream obligations should not be sellable
- `pending` payout-relevant edges should block commerce or force review
- `accepted` `reference_only` edges do not block sale
- `accepted` `attribution_only` edges may allow sale even when the sharing rule is optional rather than protocol-mandated

## Suggested V0 Edge Rules

### Songs

- `song_mode = remix`
  should normally result in at least one accepted payout-relevant upstream edge before commerce is allowed
- canonical original songs
  normally have no upstream edge

### Videos

- videos may reference songs without automatically becoming royalty-bearing derivatives
- if the creator opts into derivative attribution and commerce, review may promote the edge from `reference_only` to `licensed_derivative` or `attribution_only`

### Images And Text

- may have `attribution_only` or `reference_only` edges
- should not automatically imply hard upstream royalty passthrough

## On-chain vs Off-chain

Recommended v0 split:

- the royalty-graph record and edge classification live in Pirate's app model
- Story-native derivative relationships are mirrored into that model when relevant
- Story handles protocol-native royalty enforcement
- Pirate handles club-optional and attribution-only sharing rules

This keeps Pirate flexible without losing protocol-native compatibility where Story already provides it.

## Open Questions

- Should an asset ever attach to more than one active royalty graph, or is one graph per downstream asset enough in v0?
- Which payout-relevant edge classes should require explicit moderator or governance review before commerce is enabled?
- Should Pirate allow `attribution_only` edges to specify an explicit `share_pct` in v0, or keep that club-optional split listing-level only?
