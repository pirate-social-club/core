# Publish Matrix

Status: current working spec

Related docs:

- [composer.md](./composer.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [marketplace.md](./marketplace.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [karaoke.md](./karaoke.md)

## Purpose

This doc is the canonical matrix for what Pirate may publish, sell, and deliver in v0.

It exists to answer, in one place:

- which composer outputs create only a `post`
- which outputs may create an `asset`
- which assets may publish to Story
- which assets or live surfaces may be listed
- which delivery mechanism applies after purchase
- which parts of the product are fully specified versus still implied or deferred

## Status Meanings

- `specified`
  - the current domain docs define this behavior clearly enough to implement against
- `implied`
  - the current docs point strongly in this direction, but the rule is not yet explicit enough to treat as final without a small follow-up spec decision
- `unspecified`
  - the current docs do not yet define the behavior clearly enough to implement safely
- `deferred`
  - the type or flow is intentionally modeled, but not intended for separate v0 implementation yet

## Core Rules

- `post` is the social object
- `asset` is the rights-bearing object
- `listing` is the sell surface
- purchases settle through [MarketplaceSettlementV1](../contracts/overview.md)
- locked static assets use the CDR delivery path described in [../contracts/locked-asset-delivery.md](../contracts/locked-asset-delivery.md)
- donation is listing-level and creator-side, not buyer-selectable and not taken from upstream royalties
- nationality-tiered regional pricing is club-controlled in v0 and requires Self-backed nationality proof; buyers without that proof pay the base price

## Matrix

| Row | May create asset | Story publication | Access modes | Listing allowed | Settlement path | Delivery mechanism | Donation eligible | Regional pricing | Product completeness |
|---|---|---|---|---|---|---|---|---|---|
| Text post | `specified` | `optional` | `public` `locked` | `specified` | `MarketplaceSettlementV1` | teaser post plus locked full-text payload | yes | yes | `specified` |
| Image post (single) | `specified` | `optional` | `public` `locked` | `specified` | `MarketplaceSettlementV1` | public preview plus locked full-res media is implied | yes | yes | `implied` |
| Image post (gallery) | `implied` | `optional` | `public` `locked` | `implied` | `MarketplaceSettlementV1` | full gallery payload shape still needs explicit rule | yes | yes | `unspecified` |
| Video post | `specified` | `optional` | `public` `locked` | `specified` | `MarketplaceSettlementV1` | locked video payload with v0 download-then-play client behavior and no public teaser clip | yes | yes | `specified` |
| Link post | no | no | `public` only | no | n/a | direct outbound link | no | no | `specified` |
| Song post (original) | `specified` | `required` | `public` `locked` | `specified` | `MarketplaceSettlementV1` | locked audio through CDR + entitlement token | yes | yes | `specified` |
| Song post (remix) | `specified` | `required` when eligible | `public` `locked` | `specified` when rights path allows | `MarketplaceSettlementV1` | same as original song once rights path is valid | yes | yes | `specified` |
| Live room (free) | no separate asset required for entry | no | room access | no paid listing | n/a | room join | no | no | `specified` |
| Live room (gated) | no separate asset required for entry | no | gated room access | not necessarily paid | n/a | join requires all active membership-scope and viewer-scope community gates | no | no | `specified` |
| Live room (paid) | no separate asset required for entry | no | paid room access, public-only in v0 | `specified` | `MarketplaceSettlementV1` | ticket/entry entitlement and room join | yes | yes | `specified` |
| Replay (free) | `specified` | optional/depends on underlying asset path | `public` | no paid listing required | n/a | public playback | no | no | `specified` |
| Replay (paid or entitlement-gated) | `specified` | optional/depends on underlying asset path | `locked` | `specified` | `MarketplaceSettlementV1` | entitlement-gated replay through the same locked delivery architecture as other premium media | yes | yes | `specified` |
| Karaoke package | `specified` as asset family | Story publication depends on package contents | likely `public` and `locked` | not separately listable in v0 | n/a | package-specific asset delivery | n/a | n/a | `deferred` |

## Locked Delivery Notes By Type

### Text

Locked-in rule:

- if text is sold as a locked asset, the full sellable text payload must live in the asset-delivery layer, not only in the post body stored in the app DB
- public post rendering may show excerpt/preview text while the full sellable text is gated through the locked-asset path

### Image

Current intent:

- post-level previews and thumbnails may remain public
- the locked payload should contain the full-resolution media set

Locked-in recommendation:

- for locked image assets, `post` media refs should be treated as preview-safe derivatives
- the locked asset payload should contain the original or commercially intended full-resolution images

### Video

Locked-in rule:

- post metadata and poster-style presentation may remain social/feed-visible
- the full premium payload may be locked
- v0 video may use the same locked-delivery architecture as songs with a simple download-then-play client path
- locked video should not imply a separate teaser-video asset in v0; metadata and poster-style presentation are enough

### Replay

Current rule:

- if replay is entitlement-gated, it should still be modeled as a locked asset
- replay uses the same locked entitlement architecture as other premium media, even if replay playback UX later gets additional treatment

## Regional Pricing Policy

The pricing policy for a monetized surface is club-controlled in v0.

Locked-in rules:

- the club may define explicit country-level price outcomes or tier mappings
- the platform may suggest defaults, including PPP-style defaults, but those are only templates
- existing listings should follow the club's currently active pricing policy for future quotes rather than pinning a stale listing-era copy
- if the buyer lacks a current accepted Self nationality proof, the quote must fall back to the base price
- a community that chooses Very-only identity verification for commerce cannot use nationality-tiered regional pricing until it also accepts Self nationality proofs for pricing
- this is a mutable club-policy choice for future quotes, not an irreversible lifecycle decision

## Immediate Follow-Ups

The matrix exposes the remaining product decisions that are still intentionally open:

1. single-image commerce is locked for v0; decide later whether gallery sale should use a packaged blob or encrypted manifest model
