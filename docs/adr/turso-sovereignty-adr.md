# Turso Sovereignty ADR

Status: accepted, amended

Partially superseded by [control-plane-neon-adr.md](./control-plane-neon-adr.md) for the central control-plane database.
Amended by the April 2026 Turso quota review: Turso groups are region pools, not community
boundaries, because production plans expose many databases per org but a small fixed number of
groups/locations.

## Decision

Pirate v2 will use Turso/libSQL for community relational storage instead of D1.

The multitenant unit is:

- one Turso organization per environment
- one Turso group per supported region/location pool
- one primary Turso database per community inside the selected region group

Pirate keeps the central control-plane database on Neon Postgres.

Cloudflare Workers remain the compute platform. Durable Objects remain the live-state primitive for transient real-time workloads such as livestream room session state.

## Why

### Sovereignty

The architecture should allow a community to become an independent operational unit later without redesigning the entire storage model.

Turso is a better fit than D1 for that goal because:

- the storage model is SQLite/libSQL-compatible rather than Worker-binding-specific
- local development can use SQLite files, `turso dev`, or hosted Turso with the same client model
- groups can be transferred to another organization
- per-database BYOK exists for stronger future community ownership boundaries

Relevant Turso docs:

- local development: <https://docs.turso.tech/local-development>
- group transfer: <https://docs.turso.tech/api-reference/groups/transfer>
- encryption / BYOK: <https://docs.turso.tech/cloud/encryption>

### Scale

Cloudflare D1 is attractive on cost and Cloudflare-native ergonomics, but the hard per-database size limit and single-threaded-per-database execution model are not a good fit for the intended long-term scale of sovereign community databases.

Relevant D1 docs:

- platform limits: <https://developers.cloudflare.com/d1/platform/limits/>

### Transferability

Turso documents group transfer explicitly, but Turso plan limits make group-per-community too small
for hundreds of communities. Pirate therefore treats the community database as the isolation unit and
the region group as shared infrastructure. A future sovereignty handoff should use database transfer
if Turso supports the required workflow for the target account, or fall back to export/import with a
controlled write freeze.

## Resulting Topology

### Pirate control plane

One central Pirate database stores:

- users
- wallet attachments
- auth provider links
- verification sessions and provider-backed identity state
- global profile and global handle state
- community registry and routing metadata
- encrypted connection metadata for community databases
- scrobble ingest events and anchor batches
- global track onchain registration state
- global projections for discovery, search, and cross-community feeds
- platform-level jobs and audit state

### Community data plane

Each community gets:

- one primary database under the Pirate environment organization
- placement in the Turso group for the selected data region

The community database stores community-owned durable state such as:

- community settings and policies
- memberships and moderator state
- posts, replies, and local moderation records
- community-scoped handles, labels, and community-specific metadata
- community-owned commerce metadata and purchase records where applicable
- community-local read models and counters

### Real-time state

Cloudflare Durable Objects are still the right primitive for transient live-room state such as:

- active participant presence
- stage/session coordination
- low-latency ephemeral room state

That transient state should not be treated as the durable sovereignty boundary.

## Non-Goals

This decision does not mean:

- one database per user
- one database per post
- live cross-community SQL joins
- immediate community self-hosting on day one

## Hard Rules

- no live product feature may require cross-community SQL joins
- no community database is the canonical source of truth for global user identity
- no platform-wide secret is copied into every community database
- blobs and large media remain off-database
- community database names derive from stable Pirate IDs, not mutable routes or display names
- Turso group names derive from stable region/location keys, not community IDs

## Naming

Recommended v0 naming:

- organization slug: `pirate-dev` or `pirate-prod`
- group name: `region-<group_location>`
- primary database name: `main-<community_id>`

Reasoning:

- the organization is the environment boundary
- the group is the region quota boundary
- `community_id` is stable
- route and display name changes do not force DB migration
- database-level isolation keeps hundreds of communities viable on current Turso plans

## Transfer Model

When a community becomes sovereign, the intended handoff path is:

1. Freeze structural mutations for that community.
2. Drain projection and job backlogs for that community.
3. Confirm the receiving Turso organization exists and has the correct admins.
4. Transfer or export/import the community database to the receiving organization.
5. Mint fresh database tokens in the receiving organization.
6. Update Pirate routing and connection metadata to the new org-owned endpoints and tokens.
7. Rotate or invalidate old tokens.
8. Resume writes under the new ownership boundary.

Any continuity of old URLs or tokens during transfer should be treated as a temporary migration grace
period, not a long-term steady state.

## Consequences

Good consequences:

- sovereignty is a first-class storage boundary
- community isolation has a concrete database unit
- current Turso group/location quotas can support hundreds of communities
- local development remains SQLite-friendly
- vendor lock-in is reduced relative to a D1-bound design

Costs:

- global reads must be projection-based
- there is no convenient cross-tenant live SQL join model
- token management becomes a real control-plane problem
- community creation requires database provisioning orchestration
- community handoff is more involved than a simple group transfer

## Explicitly Avoided Designs

- one giant shared relational database for all communities forever
- one D1 database per community as the long-term sovereign-unit plan
- reliance on Turso deprecated multi-db schema or attach features as a core product primitive

Deprecated Turso docs that should not become architectural dependencies:

- multi-db schemas: <https://docs.turso.tech/features/multi-db-schemas>
- attach database: <https://docs.turso.tech/features/attach-database>
