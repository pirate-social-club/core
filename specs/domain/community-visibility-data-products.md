# Community Visibility And Data Products

Status: draft

Related docs:

- [community.md](./community.md)
- [community-machine-access.md](./community-machine-access.md)
- [post.md](./post.md)
- [feed.md](./feed.md)
- [monetization.md](./monetization.md)
- [community-money-policy.md](./community-money-policy.md)

## Purpose

This doc defines how a community controls what is visible to whom, and what costs money when accessed by machines at scale.

It replaces the abstract policy-knob model with two product-facing layers:

1. visibility: who can see what
2. data products: what structured access costs

## Core Principle

Every piece of community content has a visibility class. Some visibility classes have an optional price.

A moderator should not configure protocol fields. A moderator should answer:

- what can anyone see for free?
- what can machines see for free?
- what costs money?
- how much?

## Surface Classes

Pirate communities have these distinct content surfaces:

### Community identity

Always public in v0:

- name
- slug
- description
- join requirements
- created date

This is not configurable. It is the minimum catalog entry for any community on Pirate.

### Community stats

Separately controlled because member counts and activity metrics are more sensitive than a name:

- member count
- post count
- recent activity

Default: coarse public.

### Discussion threads

The main social surface. Split into two levels:

- thread card: title, author, timestamp, vote counts, reply count
- thread body: full post content, comments, media, structured text

Default: cards visible to members, bodies visible to members.

### Events

Scheduled livestreams, karaoke sessions, and similar time-bounded activities:

- event card: title, host, start time, status
- event content: live stream, replay, chat

Default: event cards public. Event content follows the event's own access rules.

### Listings and assets

Items for sale or with attached rights-bearing assets:

- listing card: title, price, preview image, seller
- asset payload: full media, download, license

Default: listing cards public. Asset payloads gated to buyers.

### Exports

Bulk structured access that does not map to a single content item:

- discussion feed export
- archive export
- analytics snapshot

Default: disabled until explicitly enabled and priced.

## Visibility Levels

Each surface class can be at one of these visibility levels:

- `public`: visible to anyone, including unauthenticated visitors and machine readers
- `members_only`: visible to community members who have passed join gates
- `paid`: visible to anyone who pays, regardless of membership

Not every level applies to every surface:

- community identity is always public
- community stats can be public or members_only
- thread cards can be public, members_only, or paid
- thread bodies can be members_only or paid
- event cards can be public or members_only
- listing cards are always public
- exports are always paid when enabled

## Community Defaults

Moderators set default visibility per surface class. Posts inherit these defaults.

Suggested v0 defaults:

```ts
type CommunityVisibilityDefaults = {
  community_stats: "public" | "members_only"
  thread_cards: "public" | "members_only"
  thread_bodies: "members_only"
  event_cards: "public"
  listing_cards: "public"
}
```

Default when unset:

```ts
{
  community_stats: "public",
  thread_cards: "members_only",
  thread_bodies: "members_only",
  event_cards: "public",
  listing_cards: "public",
}
```

Thread cards defaulting to members_only means a machine reader scraping the community page without joining sees the community identity and stats, but not thread titles or vote counts.

## Post-Level Overrides

Posts should not carry 20 visibility knobs. In v0, a post inherits its surface-class default from the community.

If a community allows it, a post may override visibility in narrow cases:

- a scheduled event can be forced public even in a members_only community
- a sale listing is always public-card by nature

These overrides are per-post-type, not a general visibility picker. Authors should not become licensing lawyers.

## Data Products

Visibility controls what is free. Data products control what costs money.

A data product is a bundle of structured access at a defined price. The unit of sale is the community data product, not the individual post.

### v0 data products

```ts
type CommunityDataProduct = {
  product_key: string
  enabled: boolean
  price_usd: number | null
  description: string
}

type CommunityDataProducts = {
  items: CommunityDataProduct[]
}
```

Suggested v0 products:

- `discussion_feed`: structured feed of discussion thread cards and bodies
  - enabled: false
  - price: null
- `archive_export`: full historical export of posts and comments
  - enabled: false
  - price: null
- `analytics_snapshot`: aggregated activity, engagement, and membership stats
  - enabled: false
  - price: null

When a product is enabled, the moderator must set a price in USD. When disabled, no price is required.

Enabling a data product does not grant AI training rights. Training is a separate right governed by allowed uses, not by buying a product.

### Future products

- `training_license`: separate product for AI training access
  - requires explicit community opt-in
  - requires poster-visible consent before historical content is included
  - not available in v0

## Allowed Uses

Separate from visibility and separate from pricing. Buying a data product grants read access, not unrestricted use.

v0 allowed uses:

```ts
type CommunityDataAllowedUses = {
  summarization: boolean
  analytics: boolean
  ai_training: "prohibited" | "paid_license" | "allowed"
}
```

Default:

```ts
{
  summarization: true,
  analytics: true,
  ai_training: "prohibited",
}
```

Meaning:

- buying a discussion feed export allows the buyer to read and summarize those threads
- buying an analytics snapshot allows the buyer to analyze the data
- buying any product does not allow training AI models on the data
- AI training is prohibited by default and is a contractual restriction, not a technical DRM guarantee

If AI training becomes available later, it is a separate product with a separate price, not a checkbox on an existing product.

## Revenue

v0 revenue settlement:

- all data product revenue settles to Pirate's platform operations wallet
- this is stated plainly in the moderation UI
- community treasury settlement is deferred until a real treasury exists
- this mirrors the `platform_default` mode in [monetization.md](./monetization.md)

When community treasury payout becomes available, existing data products continue to sell under the same terms. The settlement destination changes, not the product or price.

## Moderation UI

The moderation tab should have three sections:

1. Visibility
2. Data products
3. Allowed uses

Revenue information is a read-only notice, not a section.

### Visibility section

Plain-language controls:

- Community stats: Public / Members only
- Discussion threads: Public / Members only
- Event cards: Public / Members only

No protocol language. No "metadata_only" or "preview."

### Data products section

Each product is a row:

- product name
- one-line description of what the buyer gets
- enabled toggle
- price input in USD (required when enabled)

Products:

- Discussion feed export
- Archive export
- Analytics snapshot

### Allowed uses section

Short checklist:

- Summaries allowed
- Analytics allowed
- AI training: prohibited (with a plain-english note that this is contractual)

### Revenue notice

Read-only, always visible:

> Revenue from data products currently settles to Pirate's platform wallet. Community treasury payout is not available yet.

## Policy Change Semantics

Visibility and data product changes apply prospectively:

- changing thread_cards from public to members_only hides new cards from non-members going forward
- enabling a data product starts selling access to new data; it does not retroactively license old exports
- AI training policy changes are prospective by default; historical content is not retroactively relicensed

## Relationship To community-machine-access.md

The domain spec at [community-machine-access.md](./community-machine-access.md) remains the authoritative source for:

- naming boundaries (no agent_ namespace collisions)
- rights model (access, discovery, extraction, commercial, training)
- settlement progression
- enforcement model
- API shape

This doc translates that domain model into a product-facing surface that a moderator can actually configure. When the two conflict on field names or defaults, this doc wins for UI and moderator-facing behavior. The machine-access doc wins for API contracts and backend enforcement.

## Storybook States

Required stories:

- default inherited: stats public, threads members-only, no products enabled, training prohibited
- all public: stats and threads public, no products
- one product enabled: discussion feed at $0.10/100 posts
- multiple products: feed + archive, different prices
- ai training notice: training prohibited with contractual note
- settlement notice: platform wallet, treasury not available
- mobile layout
