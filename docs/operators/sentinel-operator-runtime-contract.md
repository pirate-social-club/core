# Sentinel Operator Runtime Contract

Status: draft

Related docs:

- [dVPN Domain Spec](../specs/domain/dvpn.md)
- 
- 
- 

## Purpose

This doc defines the private HTTP contract between the Pirate API worker and the Sentinel operator sidecar/service.

The operator owns the real Sentinel-specific work:

- app-funded plan allocation
- user session start
- user session end
- Sentinel RPC / CosmJS integration
- WireGuard payload generation

The API worker owns:

- Pirate auth
- paid-feature gating
- wallet linking
- persistent control-plane state
- idempotent reuse of active allocations and sessions

## Implementation Status

Current repo status:

- the Pirate API worker already calls this contract shape
- the worker-side clients are implemented
- request and response validation is implemented on the worker side
- timeout handling is implemented on the worker side
- end-session special handling for `404 {"code":"not_found"}` and `409 {"code":"already_ended"}` is implemented
- the operator itself is not implemented in this repo

Current worker entry points:

- 
- 
- 

Important current constraint:

- this doc is the source of truth for the private operator HTTP contract until a dedicated operator service repo or internal OpenAPI spec exists

## Runtime Configuration

The API worker expects these env vars:

- `SENTINEL_OPERATOR_BASE_URL`
- `SENTINEL_OPERATOR_AUTH_TOKEN`
- `SENTINEL_OPERATOR_SUBSCRIPTION_TIMEOUT_MS`
- `SENTINEL_OPERATOR_SESSION_START_TIMEOUT_MS`
- `SENTINEL_OPERATOR_SESSION_END_TIMEOUT_MS`

Rules:

- `SENTINEL_OPERATOR_BASE_URL` is not a secret and should be version-controlled or ordinary runtime config
- `SENTINEL_OPERATOR_AUTH_TOKEN` is a secret bearer token
- the worker trims trailing slashes from the base URL
- all operator routes are private `internal/v0` routes

## Authentication

The worker sends:

- `Content-Type: application/json`
- `Authorization: Bearer <SENTINEL_OPERATOR_AUTH_TOKEN>` when `SENTINEL_OPERATOR_AUTH_TOKEN` is configured

The operator should fail closed when the bearer token is missing or invalid.

Local-development note:

- the current worker implementation allows `SENTINEL_OPERATOR_AUTH_TOKEN` to be unset
- if it is unset, the worker sends no `Authorization` header
- production operator deployments should still require bearer auth

Recommended responses:

- `401` for missing auth
- `403` for invalid auth

The worker currently treats non-2xx as internal errors, so these statuses are operational signals, not user-facing API semantics.

## Endpoint List

The worker calls exactly these routes:

- `POST /internal/v0/sentinel/subscriptions/ensure`
- `POST /internal/v0/sentinel/sessions/start`
- `POST /internal/v0/sentinel/sessions/end`

## POST /internal/v0/sentinel/subscriptions/ensure

Purpose:

- ensure the user wallet has active Sentinel plan capacity funded by Pirate

Request body:

```json
{
  "user_id": "usr_dvpn_demo",
  "wallet_address": "sent1...",
  "wallet_attachment_id": "wa_01",
  "dvpn_feature_entitlement_id": "dve_01",
  "plan_key": "dvpn_default",
  "idempotency_key": "sent_sub:usr_dvpn_demo:dve_01:dvpn_default"
}
```

Field rules:

- `user_id` is Pirate’s canonical identity
- `wallet_address` is the Privy-backed Sentinel address
- `wallet_attachment_id` is included for audit correlation
- `dvpn_feature_entitlement_id` ties the allocation back to the paid feature row
- `plan_key` is Pirate’s product-level plan identifier
- `idempotency_key` must be treated as a stable dedup key for the logical allocation request

Success response:

```json
{
  "plan_key": "dvpn_default",
  "chain_subscription_id": "12345",
  "allocation_tx_hash": "ABCD1234",
  "allocated_bytes": 1073741824,
  "expires_at": "2026-05-11T12:00:00Z"
}
```

Response rules:

- `plan_key` must echo the logical plan actually allocated
- `chain_subscription_id` must be stable for the created or reused allocation
- `allocation_tx_hash` may be `null` when the operator is returning an already-existing allocation
- `allocated_bytes` may be `null` only if the plan model does not expose a byte cap
- `allocated_bytes` must never be negative
- `expires_at` may be `null` for non-expiring allocations

Idempotency contract:

- repeated calls with the same `idempotency_key` must return the same logical allocation result
- if the allocation already exists for the same user wallet and plan, the operator should return that existing allocation instead of creating a second one
- if the worker loses the HTTP response after the operator succeeds, retrying the same `idempotency_key` must not create a second on-chain allocation

Failure guidance:

- `409` may be used for internal operator conflicts such as “wallet already has an incompatible active plan”
- `422` may be used for invalid request shape or unsupported `plan_key`
- `5xx` should be reserved for indeterminate failures where the caller cannot know whether allocation succeeded

Recommended failure body:

```json
{
  "code": "allocation_failed",
  "message": "Sentinel allocation failed"
}
```

## POST /internal/v0/sentinel/sessions/start

Purpose:

- start or resume a Sentinel session for a user-backed wallet and return WireGuard connection material

Request body:

```json
{
  "user_id": "usr_dvpn_demo",
  "sentinel_subscription_id": "ssub_01",
  "chain_subscription_id": "12345",
  "wallet_address": "sent1...",
  "idempotency_key": "sent_sess:usr_dvpn_demo:ssub_01"
}
```

Field rules:

- `user_id` is Pirate’s canonical identity
- `sentinel_subscription_id` is Pirate’s internal allocation row id
- `chain_subscription_id` is the Sentinel-side subscription id that the operator should spend against
- `wallet_address` is the user wallet used for Sentinel session ownership/signing
- `idempotency_key` must deduplicate the logical session-start attempt

Success response:

```json
{
  "chain_session_id": "67890",
  "node_address": "sentnode1...",
  "transport_kind": "wireguard",
  "wireguard_config": {
    "server_endpoint": "1.2.3.4:51820",
    "server_public_key": "server_pubkey",
    "client_private_key": "client_privkey",
    "client_address": "10.10.0.2/32",
    "dns_servers": ["1.1.1.1"],
    "allowed_ips": ["0.0.0.0/0"]
  },
  "expires_at": "2026-04-11T13:00:00Z"
}
```

Response rules:

- `transport_kind` must currently be `wireguard`
- all `wireguard_config` string fields must be non-empty
- `dns_servers` and `allowed_ips` must be arrays of non-empty strings
- `client_private_key` is required on success because the worker needs it on the first write
- `expires_at` may be `null` only if the operator cannot determine a session expiry horizon

Idempotency contract:

- repeated calls with the same `idempotency_key` must return the same logical session
- if the operator already created the Sentinel session but the worker failed before persisting it, retrying must return the same `chain_session_id`
- the operator must also return the same `wireguard_config.client_private_key` for the same in-flight deduped session start, otherwise the worker cannot recover from response loss cleanly

Important note:

- this is the only place where the worker receives `client_private_key`
- the worker persists only the non-secret subset and does not replay `client_private_key` on reused sessions
- the operator therefore needs a stable session-start dedup story to survive retries safely

Failure guidance:

- `409` may be used for “subscription exhausted”, “session already active for incompatible node”, or similar deterministic conflicts
- `422` may be used for malformed or unsupported request shapes
- `5xx` should mean the operator cannot tell whether a session was created successfully
- a `200` with an invalid or non-JSON body is also treated by the worker as a hard failure

Recommended failure body:

```json
{
  "code": "session_start_failed",
  "message": "Sentinel session start failed"
}
```

## POST /internal/v0/sentinel/sessions/end

Purpose:

- terminate a Sentinel session if it is still active

Request body:

```json
{
  "chain_session_id": "67890",
  "wallet_address": "sent1..."
}
```

Success response:

- `204 No Content` is preferred
- `200` with an empty or small JSON body is also acceptable

Idempotency contract:

- end-session must be idempotent
- if the session was already ended or is missing upstream, the operator should still let the worker converge local state

Accepted already-not-active responses:

- `404` with `{"code":"not_found"}`
- `409` with `{"code":"already_ended"}`

The worker treats those `404/409` bodies as success-equivalent.

Important rule:

- the operator should not use generic `404` or `409` codes here without one of those exact body codes, because the worker parses the JSON body and treats all other non-2xx end responses as hard failure
- `404` with no JSON body, or with a body like `{"message":"not found"}`, is a hard failure from the worker’s perspective

Recommended failure body:

```json
{
  "code": "session_end_failed",
  "message": "Sentinel session end failed"
}
```

## Timeout Semantics

The worker uses separate timeouts for:

- subscription ensure
- session start
- session end

Operator guidance:

- session start may be slower than subscription ensure or session end
- long-running chain/node flows should complete within the configured timeout budgets or fail quickly
- if the operator times out after completing an upstream side effect, retry safety must come from idempotency

## Retry Model

Worker retry expectations:

- subscription ensure is safe to retry with the same `idempotency_key`
- session start is safe to retry with the same `idempotency_key`
- session end is safe to retry without an explicit idempotency key because the target is the concrete `chain_session_id`

Operator requirement:

- all three routes must be safe under at-least-once delivery from the worker

## Audit Requirements

The operator should log at minimum:

- Pirate `user_id`
- `wallet_address`
- `wallet_attachment_id` when present
- `dvpn_feature_entitlement_id` when present
- `sentinel_subscription_id` when present
- `chain_subscription_id`
- `chain_session_id`
- `idempotency_key` when present
- upstream tx hash or Sentinel RPC request ref

Sensitive material:

- never log `wireguard_config.client_private_key`
- avoid logging full WireGuard payloads

## Minimal Error Code Set

Recommended stable codes:

- `not_found`
- `already_ended`
- `allocation_failed`
- `session_start_failed`
- `session_end_failed`
- `invalid_request`
- `operator_unavailable`

Only `not_found` and `already_ended` currently have special meaning in the worker.

## Compatibility Rules

If the operator contract changes:

- do not silently rename response fields
- do not change `transport_kind` values without updating worker validation
- do not stop returning `client_private_key` on successful session creation
- do not weaken idempotency guarantees for `subscriptions/ensure` or `sessions/start`

## Suggested Implementation Notes

Recommended operator internals:

- keep an idempotency store keyed by request type plus `idempotency_key`
- tie subscription ensure to a single app-funded Sentinel treasury path
- tie session start to a single user-wallet signing path
- treat end-session as convergent cleanup rather than a one-shot mutation

Open follow-up:

- the worker still stores expired sessions as `status = ended`; if you later need analytics that distinguish timeout from user disconnect, add an explicit `end_reason` field on the worker side and mirror that distinction in operator telemetry
