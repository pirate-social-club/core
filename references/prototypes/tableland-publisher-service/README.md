# Tableland Publisher Service Prototype

Normal-runtime prototype for Tableland publication, intended as the next step after the
Cloudflare Worker spike proved that the current SDK write path fails in Workers on dynamic WASM
instantiation.

This service is the shape the Pirate Worker would call over an internal boundary.

## Routes

- `GET /health`
- `POST /internal/v0/create-community-attempt`
- `POST /internal/v0/publish-community-create`

## Runtime Decision

This prototype exists because the equivalent mutation path failed in the Cloudflare Worker spike:

- Worker reads and SDK imports worked
- Worker writes through the current Tableland SDK did not
- failure root cause was dynamic WASM instantiation inside `@tableland/sqlparser`
- the same mutation path worked in this normal-runtime prototype

Observed live latency for the successful Base Sepolia test:

- about `12.7s` for `CREATE TABLE` + insert + gateway readback

That latency is acceptable for a synchronous internal publisher call in v0, but it requires
explicit timeout budgeting.

Recommended initial budgets:

- publisher-side create timeout: `60000ms`
- Worker-side HTTP timeout to publisher: large enough to cover measured Base Sepolia publish
  latency, for example `60000ms` in local/staging until tighter production measurements exist
- timeout result after a public create-attempt already exists should map to `publication_error`
  rather than pretending the create never happened

## Required Env

- `BASE_SEPOLIA_RPC_URL`
- `TABLELAND_TEST_PRIVATE_KEY`

Optional:

- `PORT` default `8789`
- `TABLELAND_GATEWAY_URL` default `https://testnets.tableland.network/api/v1`
- `TABLELAND_CREATE_TIMEOUT_MS` default `90000`; keep this high enough to cover multi-table Base
  Sepolia publication latency
- `TABLELAND_ATTEMPTS_TABLE` can be set to a pre-provisioned shared attempts table name; if unset,
  the prototype lazily creates one and caches it in-process
- `REGISTRY_PUBLISHER_AUTH_TOKEN` should be set whenever the route is called from another process;
  the prototype now enforces bearer auth when this env var is present

## Internal Publisher Contract

The production publisher flow should include:

- `POST /internal/v0/create-community-attempt`
- `POST /internal/v0/publish-community-create`

Recommended request body for the initial public create-attempt call:

```json
{
  "actor_user_id": "usr_...",
  "actor_primary_wallet_snapshot": "0x...",
  "actor_governance_address_snapshot": null,
  "namespace_verification_id": "nv_...",
  "normalized_root_label": "example-root",
  "created_at": "2026-04-10T12:00:00.000Z"
}
```

Recommended success response for the initial public create-attempt call:

```json
{
  "ok": true,
  "registry_attempt_id": "rga_...",
  "actor_primary_wallet_snapshot": "0x...",
  "actor_governance_address_snapshot": null,
  "result_ref": "tableland://community_create_attempts_current/..."
}
```

The production canonical publish route should be:

- `POST /internal/v0/publish-community-create`

Recommended request body:

```json
{
  "registry_attempt_id": "rga_...",
  "community_id": "cmt_...",
  "created_at": "2026-04-10T12:00:00.000Z",
  "existing_table_refs": {
    "club_registry_table": "clubreg_84532_...",
    "club_namespace_table": "clubns_84532_..."
  },
  "canonical_seed": {
    "registry": {
      "display_name": "Example Community",
      "description": null,
      "status": "active",
      "governance_mode": "centralized",
      "donation_policy_mode": "none",
      "handle_policy_template": "standard",
      "updated_at": "2026-04-10T12:00:00.000Z"
    },
    "namespace_summary": {
      "namespace_id": "ns_...",
      "display_label": "example",
      "normalized_label": "example",
      "route_family": "root",
      "namespace_role": "primary",
      "status": "active",
      "root_proof_status": "verified",
      "delegation_status": "not_delegated",
      "last_verified_at": "2026-04-10T12:00:00.000Z",
      "updated_at": "2026-04-10T12:00:00.000Z"
    }
  }
}
```

Recommended success response:

```json
{
  "ok": true,
  "status": "published",
  "registry_published_at": "2026-04-10T12:00:12.000Z",
  "table_refs": {
    "attempts_table": "community_create_attempts_current_84532_...",
    "club_registry_table": "clubreg_84532_...",
    "club_namespace_table": "clubns_84532_..."
  }
}
```

Recommended failure response:

```json
{
  "ok": false,
  "status": "publication_error",
  "error_code": "tableland_timeout"
}
```

Expected publication failures should be returned as HTTP `200` with `status = "publication_error"`.
Only unexpected publisher crashes should surface as HTTP `500`.
Unexpected non-success responses use `error_code`, not `error`.

Important semantics:

- the Worker should call `create-community-attempt` before any operational Turso community row is
  created
- if that initial public create-attempt write fails, `POST /communities` fails loud
- canonical table create/seed may fail later, in which case the community becomes
  `publication_error`
- the publisher must be authenticated; bearer auth is enforced whenever
  `REGISTRY_PUBLISHER_AUTH_TOKEN` is configured
- the prototype wallet env var is only for disposable testing; production should use proper
  secret injection, and the final signer path should move to Lit-backed signing
- production should pin the shared attempts table explicitly via `TABLELAND_ATTEMPTS_TABLE` rather
  than relying on the prototype's in-process lazy-create cache

## Local Run

```bash
cd /home/t42/Documents/pirate-v2/references/prototypes/tableland-publisher-service
rtk bun install
BASE_SEPOLIA_RPC_URL=... TABLELAND_TEST_PRIVATE_KEY=... rtk bun run dev
```

Then:

```bash
rtk curl -sS http://127.0.0.1:8789/health
```

## Container Shape

This package includes a small `Dockerfile` so the same code can be tested as a Cloudflare
Container or any other containerized internal service.
