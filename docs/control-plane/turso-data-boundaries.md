# Turso Data Boundaries

Explains what belongs in the central Pirate control-plane database, what belongs in a community database, and how Cloudflare runtime state fits around both.

Related:

- [turso-sovereignty-adr.md](/home/t42/Documents/pirate-v2/docs/adr/turso-sovereignty-adr.md)
- [control-plane-schema.md](/home/t42/Documents/pirate-v2/docs/control-plane/control-plane-schema.md)
- [turso-provisioning-contract.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-provisioning-contract.md)
- [signer-families.md](/home/t42/Documents/pirate-v2/docs/operators/signer-families.md)
- [secrets-inventory.md](/home/t42/Documents/pirate-v2/docs/control-plane/secrets-inventory.md)

## Principle

The central database owns platform identity and cross-community projections.

Each community database owns the durable state that should remain meaningful if that community later leaves Pirate's organization.

## Central Control-Plane Database

The central database is the canonical home for:

- users
- wallet attachments
- auth provider links
- verification sessions
- provider-backed identity and attestation state
- global profile state
- global `.pirate` handle state
- community registry rows
- community connection metadata
- encrypted community database credentials
- scrobble ingest events
- scrobble anchor batches and batch items
- global track onchain registration state
- cross-community search projections
- cross-community feed projections
- platform-level jobs
- platform audit logs

### Why these live centrally

- user identity is platform-wide, not community-owned
- a user may participate in many communities
- global discovery and moderation need platform-level views
- connection metadata for community databases is infrastructure state, not community content

### Scrobble And Track Anchor State

Scrobble ingest events are central because:

- scrobbles are keyed by `user_id`, not `community_id`
- `community_id` is nullable on scrobbles
- a single user's scrobbles may span multiple communities
- batch anchoring groups by resolved wallet, not by club

Global track onchain registration state is central because:

- `ScrobbleV1` has a single global track registry
- track registration is a prerequisite for scrobble anchoring regardless of club context

## Community Database

The community database is the canonical home for durable community-owned state:

- community settings
- community policy and governance attachment metadata
- memberships
- bans and moderator assignments
- community-scoped handles and namespace policy artifacts
- post rows
- replies and thread state
- moderation actions and review queues
- label and community labeling state
- community-specific commerce metadata
- community-specific purchase records and entitlement records where those purchases are owned by the community surface
- community-local read models and counters
- community-local scrobble projections such as recent listeners, charts, and counters

### Why these live with the community

- they should survive a future community handoff
- they are governed primarily by community-local rules
- they do not need to be the canonical source for platform identity

## Projection Rules

No global product surface may depend on cross-community live joins.

Instead:

- community writes emit projection work
- the central database stores denormalized read models
- global feed, search, and discovery read from those projections

Examples:

- a community post write updates the community database first
- the control plane ingests a projection event
- the global feed/search projection is updated centrally

The projection may lag. The community database remains the durable source of truth for community-owned state.

Community-local scrobble surfaces are projections derived from central ingest and anchor state. They are not the canonical scrobble store.

## Identity Rules

- `user_id` is canonical and central
- wallet attachments are canonical and central
- community databases may reference `user_id`
- community databases must not become the canonical source of truth for user identity
- if a community becomes sovereign later, user references remain Pirate-issued IDs unless Pirate intentionally introduces a federation/identity translation layer

## Handle Rules

- global handles live centrally
- community-scoped handles and local naming policy artifacts live in the community database

Reasoning:

- global handles are platform identity
- local handles are community presentation state

## Commerce Rules

Two layers exist:

- Story/onchain truth
- Pirate relational product records

Recommended v0 split:

- community-owned listings, listing policy snapshots, purchase records, and community-specific entitlements live in the community database
- platform-wide user purchase summaries and global access/read-model hints may be projected centrally

This keeps sovereignty-compatible purchase history close to the community while still allowing global user surfaces.

## Jobs

Jobs are split by ownership:

- platform-level jobs live centrally
- community-owned content/moderation/media jobs live in the community database

If a job touches both boundaries, keep:

- canonical job orchestration centrally
- community-local side effects and resulting rows in the community database

## Live Rooms And Durable Objects

Durable Objects are not the sovereignty boundary.

Use Durable Objects for:

- room presence
- active session coordination
- short-lived state transitions

Persist durable metadata separately:

- if the room belongs to a community surface, persist its durable metadata in the community database
- if the room is platform-global, persist its durable metadata centrally

## Anti-Patterns

Do not:

- join across community databases at request time
- copy the full user row into every community database
- keep mutable route-derived names as the DB/group identity
- store per-community DB credentials as thousands of environment variables
- depend on Turso deprecated multi-db schema features for core product behavior

## What Transfer Looks Like

When a community group is transferred out:

- the community database goes with it
- community-local posts, memberships, moderation, and commerce records stay with it
- the central database retains platform identity, historical projections, and routing/audit records
- Pirate either stops at archival references or continues via federation/API contracts

That is the intended storage boundary from the start.
