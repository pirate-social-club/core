# Community Provision Operator Runtime Contract

Status: active

Purpose:

- define the private HTTP contract between the public API worker and the Turso community-provision operator
- keep the operator boundary stable even if the implementation changes from a Bun server to another private service

## Runtime Configuration

The public API worker expects:

- `COMMUNITY_PROVISION_OPERATOR_BASE_URL`
- `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`
- `COMMUNITY_PROVISION_OPERATOR_TIMEOUT_MS`
- `COMMUNITY_PROVISION_DEFAULT_GROUP_LOCATION`

The private operator expects:

- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_ORGANIZATION_SLUG`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION`
- `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`
- `COMMUNITY_PROVISION_OPERATOR_HOST`
- `COMMUNITY_PROVISION_OPERATOR_PORT`

Rules:

- the public worker must not hold `TURSO_PLATFORM_API_TOKEN`
- the operator must require bearer auth on private routes
- the worker and operator share the same bearer secret value through `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN`

## Implemented Operator Surface

Current in-repo entrypoint:

- [scripts/turso-control-plane-operator.ts](/home/t42/Documents/pirate-v2/scripts/turso-control-plane-operator.ts:1)

Shared handler:

- [scripts/lib/turso-control-plane-operator.ts](/home/t42/Documents/pirate-v2/scripts/lib/turso-control-plane-operator.ts:1)

Backed by existing Turso control-plane library:

- [scripts/lib/turso-control-plane.ts](/home/t42/Documents/pirate-v2/scripts/lib/turso-control-plane.ts:1)

## Authentication

Private routes require:

- `Authorization: Bearer <COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN>`

Recommended responses:

- `401` for missing or invalid auth
- `500` for server misconfiguration

## Endpoints

### `GET /health`

Purpose:

- liveness and bind-config visibility

Success response shape:

```json
{
  "ok": true,
  "bind_host": "127.0.0.1",
  "bind_port": 8789,
  "requires_bearer_auth": true
}
```

### `POST /internal/v0/community-provisioning/provision`

Purpose:

- create or reconcile one community Turso sovereignty unit and return the runtime DB credential the worker must persist encrypted

Request body:

```json
{
  "community_id": "cmt_01",
  "creator_user_id": "usr_01",
  "display_name": "Infinity",
  "namespace_verification_id": "nv_01",
  "group_location": "aws-us-east-1",
  "bootstrap_payload": {
    "description": null,
    "membership_mode": "open",
    "default_age_gate_policy": "none",
    "posting_unique_human_provider": null,
    "handle_policy_template": "standard",
    "handle_pricing_model": null,
    "namespace_label": "infinity"
  }
}
```

Success response:

```json
{
  "community_id": "cmt_01",
  "job_id": "job_01",
  "binding_id": "cdb_01",
  "credential_id": "cdc_01",
  "organization_slug": "pirate-social",
  "group_name": "club-cmt-01",
  "group_id": "grp_01",
  "database_name": "main-cmt-01",
  "database_id": "db_01",
  "database_url": "libsql://main-cmt-01-pirate-social.aws-us-east-1.turso.io",
  "location": "aws-us-east-1",
  "token_name": "worker-cmt_01-v1",
  "plaintext_token": "turso-db-token",
  "issued_at": "2026-04-12T00:00:00.000Z",
  "expires_at": null,
  "rotation_number": 1
}
```

Notes:

- `plaintext_token` is intentionally present here so the worker can encrypt and persist it in `community_db_credentials`
- the operator should not persist that plaintext token outside the control-plane workflow that already exists in `scripts/lib/turso-control-plane.ts`

### `POST /internal/v0/community-provisioning/rotate-token`

Purpose:

- rotate the active community DB token for one binding

Request body:

```json
{
  "community_id": "cmt_01",
  "reason": "live_validation"
}
```

### `POST /internal/v0/community-provisioning/doctor`

Purpose:

- return control-plane drift findings for one community or all active communities

Request body:

```json
{
  "community_id": "cmt_01"
}
```

## Current Constraint

The public runtime can now call this contract, but this repo does not yet include a production deployment target for the operator. Deployment ownership, process management, and network placement are still operational decisions.
