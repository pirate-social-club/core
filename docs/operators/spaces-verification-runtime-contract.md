# Spaces Verification Runtime Contract

Status: current runtime contract for public-v0 Spaces namespace verification

Related:

- [specs/domain/spaces-verification-flow.md](../../specs/domain/spaces-verification-flow.md)
- [specs/domain/namespace-root-control.md](../../specs/domain/namespace-root-control.md)
- [docs/operators/spaces-operator-publish-contract.md](./spaces-operator-publish-contract.md)
- [db/control-plane/migrations/0033_control_plane_namespace_verification_spaces.sql](../../db/control-plane/migrations/0033_control_plane_namespace_verification_spaces.sql)
- [db/control-plane/migrations/0048_control_plane_spaces_fabric_publish_verification.sql](../../db/control-plane/migrations/0048_control_plane_spaces_fabric_publish_verification.sql)
- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)
- [pirate-api/services/api/src/lib/verification/spaces-verifier.ts](../../pirate-api/services/api/src/lib/verification/spaces-verifier.ts)

## Goal

Spaces namespace verification proves two facts:

- the submitted `@space` resolves to a verified on-chain root key
- the operator can publish session-bound Fabric records for that root

The user action is one publish command. Server-side, Pirate still checks the root proof and the
published Fabric records separately.

## Phase-1 Conventions

For accepted Spaces rows:

- `family = 'spaces'`
- `root_exists = 1`
- `club_attach_allowed = 1`
- `control_class = 'single_holder_root'`
- `operation_class = 'owner_managed_namespace'`
- HNS-only fixed columns remain `NULL`
- canonical assertion rows carry family-specific proof state
- canonical capability rows carry family-specific capability state

Minimum Spaces assertions:

- `root_exists`
- `root_key_proof_verified`
- optional `anchor_fresh_enough`
- `fabric_publish_verified`

Minimum accepted Spaces capabilities:

- `club_attach_allowed`
- `owner_signed_record_updates_allowed = false`
- `pirate_subspace_issuance_allowed = false`

## Challenge Contract

Spaces uses the generic challenge columns introduced in migration `0033`:

- `challenge_kind = 'fabric_txt_publish'`
- `challenge_payload_json` holds the publish instructions
- `challenge_host` and `challenge_txt_value` remain HNS-only compatibility fields and stay `NULL`

Challenge payload keys:

- `kind = 'fabric_txt_publish'`
- `domain`
- `root_label`
- `root_pubkey`
- `nonce`
- `txt_key = 'pirate-verify'`
- `txt_value = 'pirate-space-verify=<session-id>:<nonce>'`
- `web_url = 'https://<domain>/c/@<canonical-root>'`
- `freedom_url = 'https://<domain>/c/@<canonical-root>'`
- `issued_at`
- `expires_at`

The public completion request for Spaces does not include a signature payload. Completing the
session means "check the published setup now." If the expected records are not visible yet and the
challenge has not expired, the session remains `challenge_pending`.

## Provider Contract

Runtime Spaces proof and Fabric resolution stay behind the provider layer:

- [pirate-api/services/api/src/lib/verification/spaces-verifier.ts](../../pirate-api/services/api/src/lib/verification/spaces-verifier.ts)

The HTTP sidecar lives at:

- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)

Sidecar endpoints:

- `GET /health`
- `GET /inspect?root_label=@space`
- `GET /resolve?root_label=@space`
- `POST /verify-publish`

`POST /verify-publish` checks:

- current root proof
- resolved Fabric TXT records
- expected `pirate-verify` TXT value
- expected web target
- expected Freedom target

Operational variables:

- `SPACES_VERIFIER_BASE_URL`
- `SPACES_VERIFIER_AUTH_TOKEN`
- `SPACED_RPC_URL`
- `SPACED_RPC_AUTH_TOKEN`
- `SPACES_VERIFIER_NATIVE_BIN`
- `SPACES_VERIFIER_HOST`
- `SPACES_VERIFIER_PORT`

Production must use a prebuilt `spaces-verifier-native` binary. `SPACES_NATIVE_ALLOW_BUILD_FALLBACK`
is local-development only.

## Start Session Sequence

For `family = spaces`:

1. Verify bearer token and validate `root_label`.
2. Normalize to canonical `@xn--...` form when needed.
3. Call `inspectSpacesNamespace(...)`.
4. Insert a `space_proof_snapshot` evidence bundle.
5. Upsert session assertions for root existence, root proof, and anchor freshness.
6. If inspection fails, write a failed session and stop.
7. Mint a session nonce and `pirate-verify` TXT value.
8. Write the session with `status = 'challenge_pending'` and `challenge_kind = 'fabric_txt_publish'`.

Spaces start sessions do not use `dns_setup_required` or `challenge_required`.

## Complete Session Sequence

For `family = spaces`:

1. Load the session row and require `status = 'challenge_pending'`.
2. Require a non-expired `fabric_txt_publish` challenge.
3. Re-run Spaces inspection to avoid accepting stale root data.
4. Resolve Fabric records for the root.
5. Require the expected `pirate-verify` TXT value.
6. Require the expected web and Freedom URLs.
7. Insert a `fabric_publish` evidence bundle.
8. Insert an `accepted_snapshot` evidence bundle.
9. Upsert session assertions, including `fabric_publish_verified`.
10. Derive session capability rows.
11. If any check fails because records have not propagated, keep `challenge_pending`.
12. If the acceptance rule fails permanently, write `status = 'failed'`.
13. If the acceptance rule passes, insert the accepted verification row.
14. Copy accepted assertions and capabilities to verification scope.
15. Update the session to `status = 'verified'` and bind `namespace_verification_id`.

## Acceptance Rule

The public-v0 Spaces acceptance rule is:

- `root_exists = true`
- `root_key_proof_verified = true`
- `fabric_publish_verified = true`
- creator has accepted `unique_human`

Failure mapping guidance:

- missing or unknown root: `root_not_found`
- provider outage: `anchor_provider_unavailable`
- stale anchor set: `anchor_set_stale`
- proof failure: `proof_not_verifiable`
- proof/root mismatch: `proof_root_mismatch`
- missing TXT record: `fabric_verify_record_not_found`
- wrong TXT value: `fabric_verify_record_mismatch`
- wrong web target: `fabric_web_target_mismatch`
- wrong Freedom target: `fabric_freedom_target_mismatch`
- challenge expired: `session_expired`
- creator lacks `unique_human`: `creator_not_unique_human_verified`

## Test Contract

Minimum coverage:

- start Spaces session returns `challenge_pending` with `challenge_kind = 'fabric_txt_publish'`
- challenge payload includes canonical root, `pirate-verify`, web URL, and Freedom URL
- complete keeps the session pending when Fabric records have not propagated
- complete returns `verified` when root proof, published TXT, and targets match
- wrong TXT or target fails with the provider failure reason
- accepted Spaces verification can be used by community create because `club_attach_allowed = 1`
- HNS tests still pass unchanged
