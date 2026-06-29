# Phase 0.1: D1 Binding Management Design

Status: current working design

This document specifies how Pirate manages Cloudflare D1 bindings for one-database-per-community on the API Worker. It is the design that must be implemented and proven end-to-end against a synthetic community before phase 1 begins.

## Constraints

- Cloudflare documents approximately 5,000 resource bindings per Worker, derived from the 1 MB script metadata limit and roughly 150 bytes per binding entry.
- Native D1 bindings are deployment configuration. Adding or removing a binding requires a `wrangler deploy` of the Worker that holds the binding.
- Pirate runs one D1 database per community. Every active community eventually needs a binding.
- Pirate currently provisions communities without a Worker redeploy. That property must not regress for any community in any wave after phase 1.
- The API Worker runs across multiple environments (development, staging, production). Binding management is per environment.
- The migration window (phase 1 and 2) requires the API to handle a mix of Turso and D1 backends on a per-community basis. The design must support both until phase 3.

## Goals

- New community creation does not require a redeploy of any service that handles traffic to existing communities.
- The D1 binding count per Worker stays below 80% of the documented cap with a documented headroom policy.
- Per-region D1 database placement matches the existing Turso group placement where practical.
- The binding directory is the single source of truth for "which backend does this community live on, and how do I reach it."
- Decommissioning a community removes its D1 binding without affecting other communities.

## Non-Goals

- Solving for unbounded community count. The design targets the current order of magnitude (hundreds) with a documented scaling path to thousands.
- Replacing the central Neon control plane. The binding directory lives in the existing control plane.
- Using the D1 REST API for latency-sensitive data access. The hot path goes through native D1 bindings.
- Per-community credential isolation. D1 has no per-database token; we already accept the shared wrap key on Turso.

## Architecture

Three layers:

1. **Router Worker** — the existing API Worker (`pirate-api-core`). Receives community traffic, looks up the binding directory, and forwards the request to the appropriate shard using a service binding. The router's wrangler config does not grow with community count.
2. **Shard Workers** — a fixed pool of N Workers (`pirate-api-shard-0` ... `pirate-api-shard-k`). Each holds up to `binding_capacity` D1 bindings. The shard's wrangler config grows only when bindings are added to or removed from that shard. Adding or removing a community causes a deploy of one shard, not the router.
3. **Binding directory** — a control-plane table that maps `community_id` to `(shard_worker_id, binding_name, backend)`. The router queries this table for every community-touching request and caches the result for a short TTL.

`backend` is `turso` or `d1`. The router uses the backend to decide which service binding to invoke. Turso traffic continues to go to a Turso shim Worker that holds the libSQL client. D1 traffic goes to the shard that owns the binding.

### Shard count and capacity

- `binding_capacity` per shard: 4,000. This is 80% of the documented 5,000 cap and gives a documented headroom policy.
- Initial shard pool: 2. Total binding budget: 8,000 communities.
- New shards are added by deploying a new Worker with a new `binding_name` prefix. The router picks them up via a service binding entry. Pool growth is rare and is a planned event, not coupled to community provisioning.

### Binding name scheme

Each shard's wrangler config has entries of the form:

```jsonc
{
  "d1_databases": [
    { "binding": "D1_C00001", "database_name": "main-com_abc123", "database_id": "..." },
    { "binding": "D1_C00002", "database_name": "main-com_def456", "database_id": "..." }
  ]
}
```

`D1_C<NNNNN>` is a per-shard five-digit slot. The control-plane row stores the full binding name. The shard rejects any access to a binding name that is not in its wrangler config; that rejection is the safety net for stale directory entries.

### Why service bindings, not direct D1 access

The router does not hold D1 bindings. The shard does. The router's wrangler config stays small and stable. Adding a new community to an existing shard does not redeploy the router.

Service bindings between Cloudflare Workers are documented to add roughly 1-5 ms of overhead. **This is an assumption; the benchmark matrix in the migration plan measures it directly before phase 1 closes.** If the measured overhead exceeds the D1 RTT win on the public community route, the architecture drops to direct D1 access for the router and accepts the per-binding deploy coupling. The benchmark report triggers that fallback decision.

## Binding Directory

Schema, in the central Neon control plane:

| Column | Type | Notes |
| --- | --- | --- |
| `community_id` | `text PRIMARY KEY` | matches the community registry |
| `shard_worker_id` | `text NOT NULL` | the Worker name to invoke (set when `backend = 'd1'`) |
| `binding_name` | `text NOT NULL` | the binding name inside the shard (set when `backend = 'd1'`) |
| `backend` | `text NOT NULL CHECK (backend IN ('turso', 'd1'))` | which service binding the router uses |
| `provisioning_state` | `text NOT NULL CHECK (provisioning_state IN ('provisioning', 'ready', 'degraded', 'decommissioned'))` | the lifecycle state |
| `region` | `text NOT NULL` | the D1 region hint, if backend = d1 |
| `migrated_at` | `timestamptz` | set when backend switches to d1 |
| `decommissioned_at` | `timestamptz` | set when the row is retired |
| `last_error_at` | `timestamptz` | set when a binding error is recorded |
| `last_error_message` | `text` | the most recent binding error, truncated to 500 chars |

The router reads the row on every community-touching request. The result is cached in a per-isolate in-memory map keyed by `community_id`. The cache has two TTLs: 60 seconds for `ready` rows, 5 seconds for `degraded` and `decommissioned` rows. Cache misses hit the control plane. Stale entries for ready rows are acceptable for at most 60 seconds; decommissioned and degraded entries correct within 5 seconds.

The control plane owns the row. The community-provision-operator writes it. The decommissioning tool clears it. The API never writes to it.

## Provisioning Flow

For a new community (current Turso path is unchanged for phase 0; the flow below is the new D1 path that lands at phase 1):

1. `community-provision-operator` calls Cloudflare to create the D1 database in the target region.
2. The operator picks the shard with the most free capacity. If no shard has free capacity, the operator fails closed and pages ops.
3. The operator generates a `binding_name` of the form `D1_C<NNNNN>` and a new wrangler config fragment for the shard.
4. The operator commits the fragment to the shard's wrangler config in its repo, opens a PR, and merges after CI. The CI step runs `wrangler deploy` against the shard.
5. The operator writes the binding directory row.
6. The router now routes to the new binding within the cache TTL.

The operator never touches the router's wrangler config. The router never redeploys for a community event.

Steps 1-3 are quick (<1 minute). Step 4 (PR + deploy) is the slow step. Step 5 happens after the deploy succeeds.

If the deploy fails, the operator leaves the directory row absent. The community is not yet routable. The community owner sees the same "provisioning" status it sees today.

## Decommissioning Flow

For a community that has been fully migrated to D1 and the Turso database dropped:

1. The decommission tool removes the binding entry from the shard's wrangler config.
2. The tool opens a PR and merges after CI.
3. The tool clears the directory row, setting `decommissioned_at`.
4. The control plane drops the Turso row that held the encrypted credential (phase 3 only).

The directory row's `decommissioned_at` lets the router ignore stale entries for the audit window. After the window, the row is hard-deleted.

## Read Path

The router's hot path for a community-touching request is:

1. `resolveCommunityBinding(env, communityId)` — reads the cache, falls through to the control plane on miss. Returns `{ shard_worker_id, binding_name, backend }`.
2. Dispatch on `backend`:
   - `turso`: invoke the Turso shim service binding with the community id and the request context.
   - `d1`: invoke the shard service binding with the community id, binding name, and the request context.
3. The shard opens the binding and runs the SQL. Results return to the router, which continues normal response shaping.

The cache is invalidated on `decommissioned_at` set, on a binding error (one-shot, recorded in Sentry), and on the 60-second TTL.

## Write Path

The write path is identical to the read path through step 2. The shard owns the D1 binding and the only path the Worker uses to obtain it is the private typed resolver described in the migration plan. The router never touches the D1 client.

The shard is a thin pass-through for phase 1. It accepts a request context and a community id, looks up the binding by name, and runs the SQL. The shard does not have its own business logic.

For phase 2, the shard also owns the transaction-redesign work. The router is unchanged.

## Failure Modes

| Failure | Behavior |
| --- | --- |
| Shard deploy fails | The binding directory row is not written. The community is not routable on D1. Status is `provisioning`. |
| Router cannot reach a shard | 503 with a `binding_unreachable` error code. The CDN retries once. Sentry captures the failure. No partial data is exposed. |
| Binding directory row missing | 404 with `community_not_found` for non-existent communities, or 503 with `binding_pending` for communities whose deploy is in flight. The error code distinguishes the two cases. |
| Binding directory row stale (points to deleted binding) | The shard rejects the binding name lookup. 503 with `binding_stale`. The router clears its cache entry. |
| Shard capacity exhausted | Provisioning fails closed. Ops is paged. Existing communities are not affected. |
| Binding directory read latency spike | The router's 60-second cache absorbs it. If the read itself fails, the router returns 503 with `binding_directory_unavailable`. The CDN retries. |
| Region hint incorrect | The shard records the actual `served_by_region` and includes it in logs. The benchmark matrix measures this directly. |
| Decommission must take effect immediately | The router maintains a second, smaller cache (5 seconds) for `decommissioned_at IS NOT NULL` rows so a decommission invalidates quickly. The 60-second cache remains for routing entries that are not decommissioned. |

## Migration From Current State

The current API Worker has zero D1 bindings. Phase 0.1 implementation steps:

1. Define the binding directory schema in the control plane migrations.
2. Add the router-side `resolveCommunityBinding` cache + read.
3. Add the shard Worker template (one Worker, no bindings).
4. Wire the router-to-shard service binding.
5. Build the operator's binding allocation and deploy path.
6. Run the synthetic-community end-to-end smoke: provision, route read, remove binding, route fallback, decommission. This is the phase 0.1 exit gate.

The smoke is the proof. It is the only thing that satisfies the exit gate. Code review of the design is not sufficient.

## Open Questions

- **Shard capacity policy.** 4,000 is a guess. The Cloudflare-published cap is approximate. The smoke test must measure actual metadata size and revise.
- **Router-to-shard auth.** Service bindings between Workers in the same account are documented as private. We accept that, but the smoke must verify the shard rejects requests for a community id that is not in its wrangler config.
- **Read-replica routing.** D1 replica reads run against the same binding name; the binding-side session factory in the migration plan decides primary vs. replica. The router does not need to know.
- **Audit window for decommissioned rows.** 30 days is a starting point. The decision is recorded when the decommission tool is built.
- **Cross-region routing.** The current design assumes the shard lives in the same region as the D1 database. If region-local routing becomes a requirement, the design grows a region-to-shard mapping. Out of scope for phase 0.1.
