# Turso Sovereignty ADR

Status: accepted

## Decision

Pirate v2 will use Turso/libSQL for relational application storage instead of D1.

The multitenant unit is:

- one Turso group per community
- one primary database per community group in v0

Pirate also keeps one central control-plane database under the Pirate-owned Turso organization.

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

Turso documents group transfer explicitly. That means the clean sovereignty boundary is a group, not a single shared central database and not an ad hoc export-only story.

Pirate should therefore treat the community Turso group as the operational handoff unit.

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

- one Turso group under the Pirate organization
- one primary database in that group in v0

The community database stores community-owned durable state such as:

- community settings and policies
- memberships and moderator state
- posts, replies, and local moderation records
- community-scoped handles, flair, and community-specific metadata
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
- community database names and group names derive from stable Pirate IDs, not mutable routes or display names

## Naming

Recommended v0 naming:

- group name: `club-<community_id>`
- primary database name: `main`

Reasoning:

- `community_id` is stable
- route and display name changes do not force DB migration
- transfer workflows stay auditable

## Transfer Model

When a community becomes sovereign, the intended handoff path is:

1. Freeze structural mutations for that community.
2. Drain projection and job backlogs for that community.
3. Confirm the receiving Turso organization exists and has the correct admins.
4. Transfer the Turso group to the receiving organization.
5. Mint fresh database or group tokens in the receiving organization.
6. Update Pirate routing and connection metadata to the new org-owned endpoints and tokens.
7. Rotate or invalidate old tokens.
8. Resume writes under the new ownership boundary.

Turso currently documents that existing URLs and tokens may continue to work after group transfer, but applications should move to the new URL and token as soon as possible. Pirate should treat that continuity as a temporary migration grace period, not a long-term steady state.

## Consequences

Good consequences:

- sovereignty is a first-class storage boundary
- community handoff has a concrete operational unit
- local development remains SQLite-friendly
- vendor lock-in is reduced relative to a D1-bound design

Costs:

- global reads must be projection-based
- there is no convenient cross-tenant live SQL join model
- token management becomes a real control-plane problem
- community creation requires database provisioning orchestration

## Explicitly Avoided Designs

- one giant shared relational database for all communities forever
- one D1 database per community as the long-term sovereign-unit plan
- reliance on Turso deprecated multi-db schema or attach features as a core product primitive

Deprecated Turso docs that should not become architectural dependencies:

- multi-db schemas: <https://docs.turso.tech/features/multi-db-schemas>
- attach database: <https://docs.turso.tech/features/attach-database>
