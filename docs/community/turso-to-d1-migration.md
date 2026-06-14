# Turso to D1 Migration

Status: active

This document specifies the migration of Pirate community databases from Turso/libSQL to
Cloudflare D1.

It supersedes the read-only-pilot framing. D1 is the target for community reads and writes;
Turso is authoritative only while per-community cutover for that community has not yet
passed. The
[Turbo sovereignty ADR](../adr/turso-sovereignty-adr.md) is partially superseded by this
plan and is fully superseded when the decommission phase completes.

This document is not an ADR. It is an active migration plan and will be amended as each phase
completes. The sovereignty, transferability, vendor lock-in, credential rotation, backup, and
recovery consequences are recorded in this document and are the basis for the eventual ADR
update.

## Decision

Pirate will migrate every community database from Turso to D1 in waves, then decommission the
Turso organization, groups, control-plane credential tables, and the wrap key.

A D1 database is the per-community storage unit. One D1 database per community, named
`main-<community_id>`, mirrors the existing Turso naming.

The API remains on Cloudflare Workers. The control-plane database remains on Neon Postgres.

## Context

The API runs on Cloudflare Workers. Each community currently uses a remote Turso/libSQL
database opened through `community-db-factory.ts`. The opening path performs a control-plane
lookup, credential decryption, libSQL client creation, and a remote HTTP request, plus
cold-isolate schema and index preflights for a database not yet seen by that isolate.

The preflights are guarded by per-isolate completion sets and in-flight deduplication. They
are a cold-isolate, per-database cost rather than a steady-state per-request cost. The
control-plane lookup, credential handling, client creation, and remote database access remain
per-open costs.

The public community route currently resolves machine-access policy and community preview
concurrently. The pilot must not compare duplicate Turso opens with a shared D1 handle. Both
backends must use equivalent request-scoped resolution.

D1 is a native Cloudflare primitive available through a Worker binding. The expected wins are
eliminating remote HTTP round trips, eliminating per-request credential decryption, and
removing the libSQL client creation overhead on every open. The expected costs are the binding
count cap, the redeploy coupling between community provisioning and Worker deploys, and the
loss of per-database token rotation.

## Goals

- Validate that native D1 access materially improves uncached community-page latency.
- Migrate all community reads to D1.
- Migrate all community writes to D1.
- Decommission Turso, including control-plane credential tables, the wrap key, the local
  file-backed SQLite fallback, and the `localDevProvisioningBackend`.
- Preserve fast file-backed SQLite for normal development and tests.
- Surface D1-specific compatibility, consistency, storage, and operational constraints
  before each phase begins.

## Non-Goals

- Preserving Turso as a long-term community database.
- Preserving per-database Turso token rotation as a steady-state operation.
- Preserving live cross-community SQL joins. None exist today; none are introduced.
- Reverting the [Turbo sovereignty ADR](../adr/turso-sovereignty-adr.md) transferability
  goal in spirit. The ADR is updated; the goal is replaced with a Cloudflare-native
  equivalent defined in this plan.
- Using the D1 REST API for latency-sensitive data access.
- Using cache hit rates as a database performance metric.

## Phase Structure

The migration is sequenced. Each phase has explicit entry gates and exit gates. A phase does
not begin until its entry gates pass.

### Phase 0 — Preconditions

Blocking work that must complete before any community is touched.

#### 0.1 Binding management design

Native D1 bindings are Worker deployment configuration. A database-per-community design
therefore couples community provisioning and archival to Worker binding changes and
redeployment. The current Turso flow provisions a community without a Worker redeploy; the D1
flow must not regress that property for any community in any wave after phase 1.

Deliverable: a written design for binding management covering:

- binding creation, removal, and rotation under the per-community cap
- deployment coordination, rollback, and partial-failure behavior
- behavior while provisioning is in flight
- community availability during API deploy failures
- sharding across multiple Workers when binding count or script metadata approaches the
  documented Cloudflare cap
- routing that does not fall back to the D1 REST API for latency-sensitive data access

Entry gate: design reviewed and accepted.
Exit gate: a small implementation proves the design against a single synthetic community end
to end (create binding, deploy, route read, remove binding, route fallback) before phase 1.

#### 0.2 Transaction redesign designs

The codebase uses interactive `client.transaction("write")` extensively. D1 does not provide
the same interactive transaction model. Before any community is cut over, the following sites
must have a written D1 batch and conditional-SQL design:

- post creation
- comment creation and mutation
- moderation actions
- community handle claims
- purchase settlement

Each design must specify:

- atomicity boundary
- uniqueness and concurrency behavior
- idempotency behavior
- conditional update strategy
- partial-failure behavior
- retry safety
- error mapping
- compensation or reconciliation requirements

Entry gate: all five designs written and reviewed.
Exit gate: the post-creation design is implemented and tested end to end against a
synthetic D1 database before phase 1.

#### 0.3 Data inventory

Per-community Turso database size, row counts by table, and `comment_closure` depth. Required
to choose wave ordering and to identify any community that will not fit in 10 GB on D1 even
after archival.

Entry gate: inventory script written.
Exit gate: inventory complete for all active communities.

### Phase 1 — Pilot Community, Reads Only

One small representative community is migrated to D1 for reads only. Turso remains the
source of truth and the write target for this community and every other community.

- A native D1 read adapter is implemented against `sql-client.ts`.
- The `sql-client.ts` contract is split: read paths use a read-capable sub-interface
  containing `execute` and `batch`; the existing full client extends that with interactive
  transactions. No fake or partially compatible `transaction()` is exposed on the read
  interface.
- Request-scoped shared community database resolution is added to
  `routes/public-communities.ts` for both Turso and D1, so the benchmark compares equivalent
  paths.
- The benchmark matrix in this document is run end to end.

Entry gate: phase 0 complete and benchmark harness deployable.
Exit gate: read-pilot gates pass; team signs off on read-path adoption criteria.

### Phase 2 — Per-Community Wave Migration

Each community is migrated individually. Waves are ordered by the criteria in this
document. For each community:

1. Provision a D1 database in the appropriate region.
2. Backfill from Turso: full table copy, index creation, projection rebuild where applicable.
3. Validate: row counts per table, projection integrity spot checks, hash of read-only
   computed fields where stable.
4. Freeze writes for the community. Hard freeze is the default. Queue-and-drain may be used
   for communities whose write traffic cannot tolerate a freeze; the choice is recorded in
   the wave plan.
5. Cut over reads to D1. Maintain Turso as a standby.
6. Cut over writes to D1.
7. Verify consistency over a defined observation window (length chosen by traffic shape;
   minimum 24 hours for non-trivial communities).
8. Decommission the Turso database for this community.

Entry gate: phase 1 complete.
Exit gate: every active community has been cut over and observed.

### Phase 3 — Turso Decommission

Once the last community has cleared phase 2:

- Drop the Turso organization and groups.
- Drop the control-plane community database credential tables.
- Drop `TURSO_COMMUNITY_DB_WRAP_KEY` from Infisical.
- Remove the `localDevProvisioningBackend` and the file-backed SQLite fallback from
  `community-local-db.ts`.
- Remove the `decryptCommunityDbCredential` helper and its callers.
- Remove the Turso-specific code paths from `community-db-factory.ts` and the control-plane
  provisioning backend.
- Update the Turso sovereignty ADR to "superseded by Turso to D1 migration."
- Update the control-plane Neon ADR if its references to Turso need cleanup.

Entry gate: phase 2 complete.
Exit gate: no remaining production code path references Turso or the wrap key.

## Wave Ordering

Waves are ordered by a documented function of:

- community size in bytes, ascending
- writes per day, ascending
- opt-in status, where the community owner has explicitly accepted migration risk

Smaller, quieter, opt-in communities migrate first. A community that exceeds 7 GB is held
out of waves until the archive plan from the dataset tests is implemented; it cannot be
migrated to a single D1 database under the 10 GB cap with safe headroom.

## Write Freeze Strategy

Hard freeze is the default. The community sees a brief 503 on write paths during cutover,
not a queue. Queue-and-drain is allowed only when the community owner has accepted the
additional complexity; it must be implemented and tested before the wave plan is approved.

The freeze window per community is bounded and recorded in the wave plan. If the freeze
exceeds the budget, the wave is rolled back and the community stays on Turso until the
process is improved.

## Rollback

Once a community's writes have gone to D1, going back to Turso requires importing D1 state
back into Turso. Rollback procedure:

1. Freeze writes on D1 for the community.
2. Export the D1 database using the same backfill tool in reverse.
3. Re-create the Turso database and apply the export.
4. Validate row counts and projections.
5. Cut reads and writes back to Turso.
6. Open a post-mortem on what failed; do not retry the same wave.

The rollback tool must exist and be tested against a synthetic D1 database before the first
real wave begins.

## Adapter Contract

The D1 adapter is implemented directly against interfaces in `sql-client.ts`. The production
D1 path uses the native D1 Worker binding API; it does not wrap `@libsql/client` and does not
translate through a libSQL client.

The current `Client` interface requires interactive `transaction()`, which D1 cannot implement
with equivalent semantics. The contract is split: read paths depend on a read-capable
sub-interface containing `execute` and `batch`. The full client extends that with interactive
transactions. The D1 read adapter must not provide a fake or partially compatible
`transaction()`.

The adapter normalizes D1 results into the existing `QueryResult` shape for:

- `execute`
- `batch`
- rows and affected-row metadata
- errors needed by callers

Session behavior is an optional read capability rather than a mandatory method. A narrow
`ReadSessionFactory` provides:

- primary-constrained sessions
- replica-eligible sessions
- bookmark input and output
- D1 serving metadata

File-backed SQLite implements a trivial primary-only session for tests that only require the
common contract.

The read adapter does not expose a generic string-indexed database lookup such as
`env.DB.get(id)`. Database selection goes through a private typed community resolver that
is the only path the Worker uses to obtain a community database capability.

## Capability Boundaries

Static D1 bindings do not provide per-community credentials. A compromised Worker with
access to all bindings can access every bound community database. The existing Turso design
also has a shared wrap key capable of decrypting every stored community credential, so this
is an operational capability change rather than a new application authorization boundary.

The D1 design preserves explicit code-level capabilities:

- read-only community database access for the public read paths
- a separate write capability, introduced at phase 2
- no generic database-by-binding-name API available to route handlers
- database resolution scoped to a validated community identifier
- structured logging of the selected community, backend, and serving region without exposing
  credentials or binding internals

Per-database Turso token rotation and revocation do not have direct D1 equivalents. The
operational rotation story becomes binding rotation, which is a Worker deploy. That loss is
recorded and is the basis for the ADR update.

## Read Replication

The D1 measurements and the D1 production paths distinguish primary reads from
replica-eligible reads.

Primary-constrained case:

```ts
db.withSession("first-primary")
```

Replica-eligible case:

```ts
db.withSession()
```

The pilot must capture:

- session bookmark input and output
- `served_by_region`
- `served_by_primary`
- total request latency
- individual query latency
- read-after-write behavior in a focused compatibility test

A session created from a prior bookmark must never observe a database version older than
that bookmark. Replica lag must not be hidden by measuring only eventually consistent
public reads.

## Benchmark Matrix

Measure these four backend modes:

1. Current Turso, cold and warm isolates.
2. Turso with request-time preflights removed and one request-scoped database resolution.
3. D1 with a primary-constrained session.
4. D1 with read replication enabled and a replica-eligible session.

Run each mode from at least:

- North America
- Europe
- APAC

Use the same representative community dataset, query shape, response hydration, Worker code
version, and cache-disabled request path.

Record at least:

- p50, p95, and p99 total response latency
- control-plane routing latency
- credential lookup and decryption latency where applicable
- database setup latency
- query count
- per-query and total database latency
- response construction and hydration latency
- cold-isolate and warm-isolate results
- errors, timeouts, overload responses, and retries
- D1 serving region and primary/replica status
- rows read and rows written reported by D1

Do not use CDN or application cache hit rates as a success metric. The purpose is to
determine whether the uncached source path is fast enough that caching becomes an
optimization rather than a requirement.

A read-pilot adoption recommendation requires D1 to produce at least a 30% p95 reduction
versus cleaned-up Turso in at least two of three regions, with no regression in the third.
A weaker result requires an explicit exception recorded in the phase 1 exit review.

## Dataset And Storage Tests

D1 has a hard 10 GB limit per paid database. Stored table data, indexes, and SQLite metadata
all count toward that limit. Community media remains outside the relational database.

Build production-shaped datasets at approximately 1 GB and 5 GB. The generator models
amplification from:

- table and index overhead
- posts and comments
- `comment_closure`
- memberships and roles
- translations
- snapshots
- jobs
- moderation records
- assistant chats and messages
- commerce records

For each dataset, record database size, table sizes, row counts, index amplification, query
latency, import duration, migration duration, and operational headroom.

A focused boundary test exercises D1's 2 MB maximum row behavior. Large media and payloads
that do not belong in relational storage are not used to justify consuming the database
limit.

The per-community Turso size inventory from phase 0 is correlated with the dataset tests to
predict which communities will fit, which need archival, and which cannot be migrated as a
single D1 database.

## Local Development And Tests

Normal Bun development and unit tests use file-backed SQLite through the common SQL client
interface. Developers do not need a full D1 simulator for ordinary work.

A focused Wrangler/Miniflare D1 compatibility suite executes the native D1 adapter. It covers
more than successful row retrieval:

- result normalization through `sql-client.ts`
- parameter binding and SQLite SQL compatibility used by pilot queries
- atomic success and rollback behavior for `batch`
- session creation and bookmark propagation
- primary-constrained versus replica-eligible session selection
- `served_by_region` and `served_by_primary` propagation when available remotely
- expected absence of remote serving metadata in local simulation
- 2 MB row-limit failure behavior
- D1 error normalization
- migrations and representative production-shaped schema loading

Tests that assert read-replica placement or remote serving metadata run against remote D1
in a controlled environment. Miniflare cannot prove global replica routing.

The phase 2 wave tool also has tests: backfill from Turso, validation, rollback export. Both
directions are exercised against synthetic D1 databases.

## Dynamic Binding Constraint

Cloudflare documents a binding count cap per Worker, derived from script metadata limits. The
exact number is reported in the phase 0.1 design. The more important constraint is that
native D1 bindings are Worker deployment configuration.

The phase 0.1 design must remove the per-bind deploy coupling from the steady-state path
before phase 2 starts. Phase 1 may use a small fixed set of bindings because only one
community is in scope.

## Per-Community Migration Gates

A community is not considered cut over until all of the following pass:

- backfill row counts match Turso within tolerance for every table
- projection integrity spot checks pass
- read cutover has been observed for the observation window with no D1 errors attributable
  to data
- write cutover has been observed for the observation window with no D1 errors attributable
  to data
- the wave plan's freeze budget was not exceeded
- rollback procedure tested once for this community's shape

If any gate fails, the community stays on Turso and the wave is retried only after the
underlying issue is fixed.

## Adoption Gates

The migration is complete when:

- every active community has cleared the per-community migration gates
- the Turso decommission phase has run end to end
- the Turso sovereignty ADR is updated to "superseded by Turso to D1 migration"
- the control-plane Neon ADR is updated if its Turso references need cleanup
- production deploys no longer carry Turso secrets, bindings, or code paths

## Open Questions

- Wave ordering: size ascending, traffic ascending, or opt-in first? The current doc chooses
  all three ascending. A pilot of the first wave will validate.
- Backfill tool: one-shot `turso db shell` to `wrangler d1 execute`, or a custom exporter?
  Phase 0.1 picks one and writes the rationale.
- Hard freeze vs. queue-and-drain default: hard freeze is the default; queue-and-drain is
  opt-in. A community that needs queue-and-drain must request it during wave planning.
- Region mapping: which Cloudflare D1 region does each community land in, and does that
  match the existing Turso group placement? Phase 0.1 decides.

## Deliverables

- Native D1 read adapter and optional session capability.
- Native D1 write adapter with batch-based transaction equivalents for the five named sites.
- `sql-client.ts` split into a read sub-interface and a full client.
- Request-scoped shared community database resolution for measured paths, applied to both
  backends.
- Binding management design and a working end-to-end implementation against a synthetic
  community.
- Wave tool: backfill, validate, freeze, cutover, rollback, decommission.
- Per-community Turso size inventory.
- Reproducible 1 GB and 5 GB production-shaped datasets.
- Four-mode, three-region benchmark report.
- Query and latency traces for the full community-page path.
- Per-wave plan, observation report, and exit review.
- Final ADR update.
