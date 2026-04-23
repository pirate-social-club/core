# Core Control-Plane Column Audit

Date: 2026-04-23

Scope: static live-code sweep for `users`, `communities`, and `verification_sessions` against `pirate-api/services/api/src`, `scripts`, and local service sources. Tests, specs, docs, and migration DDL were excluded when judging runtime use.

## `users`

Live columns:

- `user_id`
- `primary_wallet_attachment_id`
- `verification_state`
- `capability_provider`
- `verification_capabilities_json`
- `verified_at`
- `current_verification_session_id`
- `created_at`
- `updated_at`

Drift:

- `nationality` is dead as a standalone storage column. Runtime gates, commerce pricing, and serialization use `verification_capabilities_json.nationality`; the standalone column is only selected/inserted as legacy shape.

## `communities`

Live columns:

- `community_id`
- `creator_user_id`
- `display_name`
- `membership_mode`
- `status`
- `provisioning_state`
- `transfer_state`
- `route_slug`
- `namespace_verification_id`
- `pending_namespace_verification_session_id`
- `primary_database_binding_id`
- `created_at`
- `updated_at`

Drift:

- `registry_publication_state` is only read by `scripts/control-plane/inventory-control-plane.ts`.
- `registry_attempt_id`, `registry_published_at`, `registry_publication_job_id`, `registry_error_code`, and `registry_last_mutation_published_at` have no live service/script references.
- `projected_member_count` and `projected_qualified_member_count` have no live service/script references.

## `verification_sessions`

Live columns:

- `verification_session_id`
- `user_id`
- `provider`
- `session_kind`
- `requested_capabilities_json`
- `verification_requirements_json`
- `status`
- `upstream_session_ref`
- `result_ref`
- `failure_code`
- `wallet_attachment_id`
- `verification_intent`
- `policy_id`
- `started_at`
- `completed_at`
- `expires_at`
- `created_at`
- `updated_at`

Drift: none found.
