# Spaces Verification Runtime Contract

Status: execution handoff for the first runtime implementation

Related:

- [specs/domain/spaces-verification-flow.md](../../specs/domain/spaces-verification-flow.md)
- [specs/domain/namespace-root-control.md](../../specs/domain/namespace-root-control.md)
- [docs/operators/spaces-operator-signing-contract.md](./spaces-operator-signing-contract.md)
- [db/control-plane/migrations/0033_control_plane_namespace_verification_spaces.sql](../../db/control-plane/migrations/0033_control_plane_namespace_verification_spaces.sql)
- [specs/api/src/components/schemas/verification.yaml](../../specs/api/src/components/schemas/verification.yaml)
- 
- 
- [scripts/lib/control-plane-fixtures.ts](../../scripts/lib/control-plane-fixtures.ts)

## Goal

Implement the first executable `family = spaces` namespace-verification path without changing the downstream community-create contract.

The output remains the same:

- accepted `namespace_verification_id`
- `club_attach_allowed = true`
- community create consumes that accepted verification

Operational note:

- Pirate-side verification is implemented.
- This repo now includes a local operator helper for raw digest signing at
  [services/verifier/spaces/scripts/sign-digest.ts](../../services/verifier/spaces/scripts/sign-digest.ts).
- Public operator usability still depends on the Spaces toolchain exposing a first-class raw
  digest-signing primitive for the current root key. See
  [docs/operators/spaces-operator-signing-contract.md](./spaces-operator-signing-contract.md).

The phase-1 Spaces runtime does not include:

- Pirate-managed `name@space` issuance
- delegated-handle certificates from `subs`
- owner-signed record-update transport
- background revalidation automation

## Runtime Boundary

The current template runtime is HNS-only in three places:

- service flow in 
- SQL writes in 
- fixture shape in [control-plane-fixtures.ts](../../scripts/lib/control-plane-fixtures.ts)

The Spaces implementation should patch those paths, not invent a second namespace-verification stack.

The community-create gate in  already checks only:

- accepted verification status
- `club_attach_allowed`

That means community create should need no protocol-specific Spaces logic once the verification row is written correctly.

## Phase-1 Conventions

For accepted Spaces rows, use these conventions:

- `family = 'spaces'`
- `root_exists = 1` on the accepted verification row
- `club_attach_allowed = 1` on the accepted verification row
- `root_control_verified = NULL`
- `expiry_horizon_sufficient = NULL`
- `routing_enabled = NULL`
- `pirate_dns_authority_verified = NULL`
- `pirate_web_routing_allowed = NULL`
- `pirate_subdomain_issuance_allowed = NULL`
- `control_class = 'single_holder_root'` unless stronger evidence is available
- `operation_class = 'owner_managed_namespace'` for public-v0 Spaces attach

Important:

- `owner_signed_updates_namespace` is reserved for a later phase where Pirate actually verifies owner-signed record updates as an ongoing namespace operation
- `pirate_subspace_issuance_allowed` lives only in canonical capability rows, not as a new fixed verification column
- `owner_signed_record_updates_allowed` should stay `0` in phase 1

## Challenge Contract

Spaces should use the generic challenge columns introduced in migration `0033`:

- `challenge_kind = 'schnorr_sign'`
- `challenge_payload_json` holds family-specific material

Recommended Spaces challenge payload keys:

- `message`
- `digest`
- `algorithm`
- `domain`
- `issued_at`
- `expires_at`
- `root_label`

Recommended values:

- `algorithm = 'bip340_schnorr'`
- `domain = 'pirate-spaces-verification'`

The public completion payload should accept:

- `signature`
- `algorithm`
- optional `signer_pubkey`
- optional `digest`

`challenge_host` and `challenge_txt_value` remain legacy HNS-only compatibility fields and should stay `NULL` for new Spaces sessions.

## Provider Contract

Do not embed Spaces RPC or proof-parsing details directly into `verification-service.ts`.

Add a provider layer analogous to the HNS inspector, for example under:

- `pirate-api/services/api/src/lib/verification/spaces-verifier.ts`

The normalized provider result should include at least:

- `rootExists`
- `rootKeyProofVerified`
- `anchorFreshEnough`
- `acceptedAnchorHeight`
- `acceptedAnchorBlockHash`
- `acceptedAnchorRootHash`
- `proofRootHash`
- `rootPubkey`
- `controlClass`
- `operationClass`
- `observationProvider`
- `failureReason`
- `proofPayload`

Rules:

- the provider proves current root-key control material for `@space`
- the service layer mints the Pirate challenge nonce and digest
- the service layer verifies the submitted signature against `rootPubkey`

For local execution, the current implementation expects an HTTP sidecar at `SPACES_VERIFIER_BASE_URL` and ships one in [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts). The sidecar contract is:

- `GET /inspect?root_label=@space|space`
- `POST /verify-signature`
- optional bearer auth on the sidecar via `SPACES_VERIFIER_AUTH_TOKEN`
- optional Basic auth to `spaced` via `SPACED_RPC_AUTH_TOKEN`

Operational note:

- production-style runs should set `SPACES_VERIFIER_NATIVE_BIN` to a prebuilt
  `spaces-verifier-native` binary
- `SPACES_VERIFIER_HOST` controls the listener bind address
- `SPACES_NATIVE_ALLOW_BUILD_FALLBACK=true` is reserved for local development and should not be set
  on the VPS

`SPACES_VERIFIER_BASE_URL` may be configured as either the service root like `http://127.0.0.1:4047` or the legacy inspect endpoint like `http://127.0.0.1:4047/inspect`. The worker now normalizes both.

Recommended bind policy:

- local bring-up with no reverse proxy: `SPACES_VERIFIER_HOST=0.0.0.0`
- VPS behind HTTPS reverse proxy: `SPACES_VERIFIER_HOST=127.0.0.1`

## File-Level Changes

Patch these files first:

- 
- 
- 
- 
- 
- [scripts/lib/control-plane-fixtures.ts](../../scripts/lib/control-plane-fixtures.ts)

The type and store layer should widen from HNS-only to shared namespace verification:

- `family` becomes `'hns' | 'spaces'`
- `operation_class` includes `'owner_signed_updates_namespace'`
- session rows gain `challenge_kind`, `challenge_payload_json`, `anchor_height`, `anchor_block_hash`, `anchor_root_hash`, `proof_root_hash`
- verification rows gain `anchor_height`, `anchor_block_hash`, `anchor_root_hash`, `proof_root_hash`
- the Spaces verifier wire format uses `accepted_anchor_*` prefixes; the repository layer maps these to the `anchor_*` DB columns
- HNS-only convenience fields on verification rows become nullable in runtime types

The store interface should add explicit write helpers for canonical records:

- `insertNamespaceVerificationEvidenceBundle(...)`
- `upsertNamespaceVerificationAssertion(...)`
- `upsertNamespaceVerificationCapability(...)`

The runtime should not keep open-coded ad hoc SQL for those tables inside the service layer.

## Start Session Write Sequence

`startNamespaceVerificationSession(...)` should follow this sequence for `family = spaces`:

1. Verify bearer token and validate `root_label`.
2. Normalize the submitted root label.
3. Call `inspectSpacesNamespace(...)`.
4. Insert a `space_proof_snapshot` evidence bundle for the current proof observation.
5. Insert or upsert session-scoped assertion rows:
   - `root_exists`
   - `root_key_proof_verified`
   - optional `anchor_fresh_enough`
6. If inspection fails, write a failed session and stop.
7. If inspection succeeds, mint a Pirate nonce challenge and digest.
8. Write the session with `status = 'challenge_pending'`.

The start-session row contract for a successful Spaces inspection is:

- `challenge_kind = 'schnorr_sign'`
- `challenge_payload_json` populated
- `root_exists = 1`
- `root_control_verified = NULL`
- `expiry_horizon_sufficient = NULL`
- `routing_enabled = NULL`
- `pirate_dns_authority_verified = NULL`
- `club_attach_allowed = NULL`
- `pirate_web_routing_allowed = NULL`
- `pirate_subdomain_issuance_allowed = NULL`
- `control_class = provider.controlClass ?? 'single_holder_root'`
- `operation_class = provider.operationClass ?? 'owner_managed_namespace'`
- `observation_provider = provider.observationProvider`
- `evidence_bundle_ref = <space_proof_snapshot id>`
- `anchor_height`, `anchor_block_hash`, `anchor_root_hash`, `proof_root_hash` populated when available
- `failure_reason = NULL`

Failure mapping guidance:

- missing or unknown root: `root_not_found`
- provider outage: `anchor_provider_unavailable`
- stale anchor set: `anchor_set_stale`
- proof failure: `proof_not_verifiable`
- proof/root mismatch: `proof_root_mismatch`

Spaces start sessions should not use:

- `dns_setup_required`
- `challenge_required`

Public-v0 Spaces can move directly from inspection to `challenge_pending`.

## Complete Session Write Sequence

`completeNamespaceVerificationSession(...)` should treat `family = spaces` as a synchronous challenge-response completion.

If `restart_challenge = true`:

- re-run the start-session inspection flow
- issue a fresh nonce and digest
- overwrite `challenge_kind`, `challenge_payload_json`, `challenge_expires_at`
- keep the same `namespace_verification_session_id`

If `restart_challenge` is not set:

1. Load the session row and require `family = 'spaces'`.
2. Require `status = 'challenge_pending'`.
3. Require a non-expired challenge.
4. Require `requestBody.signature_payload.signature`.
5. Re-run `inspectSpacesNamespace(...)` to avoid accepting a stale or transferred root.
6. Re-check `root_exists`, `root_key_proof_verified`, and anchor freshness.
7. Verify the submitted signature against the challenge digest and the provider `rootPubkey`.
8. Insert a `challenge_signature` evidence bundle for the submitted signature.
9. Insert an `accepted_snapshot` evidence bundle that summarizes the accepted proof and signature pair.
10. Upsert session-scoped assertion rows:
    - `root_exists`
    - `root_key_proof_verified`
    - optional `anchor_fresh_enough`
    - `live_signature_verified`
11. Derive session-scoped capability rows:
    - `club_attach_allowed`
    - `owner_signed_record_updates_allowed`
    - `pirate_subspace_issuance_allowed`
12. If the acceptance rule fails, write `status = 'failed'` and stop.
13. If the acceptance rule passes, insert the accepted verification row.
14. Insert verification-scoped assertion rows copied from the accepted session result.
15. Insert verification-scoped capability rows copied from the accepted session result.
16. Update the session to `status = 'verified'` and bind `namespace_verification_id`.

## Acceptance Rule

The phase-1 Spaces acceptance rule is:

- `root_exists = true`
- `root_key_proof_verified = true`
- `live_signature_verified = true`
- creator has accepted `unique_human`

Derived capability values are:

- `club_attach_allowed = 1` only when the full acceptance rule passes
- `owner_signed_record_updates_allowed = 0`
- `pirate_subspace_issuance_allowed = 0`

Failure mapping guidance:

- missing signature payload: `challenge_not_signed`
- invalid signature bytes or digest mismatch: `invalid_signature`
- valid signature by wrong key: `wrong_signer`
- challenge expired: `session_expired`
- root changed between inspection and completion: `contradictory_root_evidence`
- creator lacks `unique_human`: `creator_not_unique_human_verified`

## Accepted Verification Row Contract

When acceptance succeeds, `ensureNamespaceVerification(...)` should write the accepted Spaces row with:

- `family = 'spaces'`
- `status = 'verified'`
- `root_exists = 1`
- `root_control_verified = NULL`
- `expiry_horizon_sufficient = NULL`
- `routing_enabled = NULL`
- `pirate_dns_authority_verified = NULL`
- `club_attach_allowed = 1`
- `pirate_web_routing_allowed = NULL`
- `pirate_subdomain_issuance_allowed = NULL`
- `control_class = session.control_class`
- `operation_class = session.operation_class`
- `observation_provider = session.observation_provider`
- `evidence_bundle_ref = <accepted_snapshot id>`
- `anchor_height`, `anchor_block_hash`, `anchor_root_hash`, `proof_root_hash` copied from the accepted session

`root_exists` remains a required convenience projection on accepted verification rows for every family.

For Spaces:

- set `root_exists = 1` whenever the accepted `root_exists` assertion is true
- leave the HNS-only fixed columns `NULL`
- rely on canonical assertion and capability rows for family-specific meaning

## Canonical Assertion And Capability Rules

Assertion and capability rows are the canonical source for family-specific state.

Implementation rules:

- include `family` on every assertion row
- include `family` on every capability row
- for session-only state, set `namespace_verification_id = NULL`
- after acceptance, write verification-scoped rows as the durable accepted record
- use upsert semantics, not append-only duplicates

Minimum Spaces session assertions:

- `root_exists`
- `root_key_proof_verified`
- optional `anchor_fresh_enough`
- `live_signature_verified`

Minimum accepted Spaces capabilities:

- `club_attach_allowed`
- `owner_signed_record_updates_allowed`
- `pirate_subspace_issuance_allowed`

## Fixture Contract

Update [control-plane-fixtures.ts](../../scripts/lib/control-plane-fixtures.ts) in two passes.

Pass 1:

- keep the existing HNS fixture behavior
- add `family` to inserted assertion rows
- insert canonical capability rows for HNS fixtures so seeded data matches migration `0026`

Pass 2:

- add a dedicated Spaces fixture helper once the provider shape is stable
- seed at least one accepted Spaces verification with:
  - accepted verification row
  - accepted assertions
  - accepted capabilities
  - accepted snapshot evidence bundle

The first runtime pass does not need full real Spaces proof generation inside fixtures. A deterministic fake provider result is acceptable for unit tests.

## Test Contract

Patch these tests before calling the Spaces path complete:

- 
- 

Minimum test coverage:

- start Spaces session returns `challenge_pending` with `challenge_kind = 'schnorr_sign'`
- complete Spaces session with valid signature returns `verified`
- wrong signature fails with `wrong_signer` or `invalid_signature`
- expired or restarted challenge invalidates the old signature
- accepted Spaces verification can be used by community create because `club_attach_allowed = 1`
- HNS tests still pass unchanged

## Order Of Implementation

Implement in this order:

1. widen runtime types in `types/db.ts` and `lib/db.ts`
2. add SQL support for generic challenge fields, anchor fields, assertions, and capabilities
3. add the Spaces provider facade
4. branch `verification-service.ts` by `family`
5. patch fixtures and tests

Do not start by wiring the real `spaces` repo transport directly into the Worker handler. Lock the runtime write model first.
