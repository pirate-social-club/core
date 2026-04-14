# Spaces Verification Flow

Status: draft

Related docs:

- [namespace-root-control.md](./namespace-root-control.md)
- [namespace.md](./namespace.md)
- [community.md](./community.md)
- [public-v0-club-enforcement.md](./public-v0-club-enforcement.md)
- [../../docs/operators/spaces-verification-runtime-contract.md](../../docs/operators/spaces-verification-runtime-contract.md)
- [../api/overview.md](../api/overview.md)

## Purpose

This doc defines the concrete public v0 Spaces verification lifecycle that produces `namespace_verification_id` for a Spaces root such as `@kanye`.

It exists to make the Spaces branch of [namespace-root-control.md](./namespace-root-control.md) implementable without coupling Pirate to Pirate-managed subspace issuance.

This flow is separate from:

- user identity verification such as `unique_human`
- community creation itself
- later Pirate-managed `name@space` issuance
- the broader off-chain certificate and delegation surface in `subs`

## Public V0 Scope

Public v0 Spaces namespace verification supports:

- `family = spaces`
- verification of a top-level Spaces root such as `@kanye`
- issuance of a server-trusted `namespace_verification_id`
- creator-bound proof that the current root key is live and controlled during the current session

Public v0 Spaces namespace verification does not itself:

- create a club
- issue `name@space` handles
- accept off-chain delegated-handle certificates as a prerequisite
- imply that Pirate has authority to issue or revoke subspaces

The public-v0 product goal is conservative:

- verify the root
- attach the community
- leave subordinate issuance off until the community is large enough and the policy is explicit

## Core Outputs

Successful Spaces verification must produce:

- `namespace_verification_id`
- normalized root label
- creator binding
- accepted evidence bundle reference
- accepted assertion set
- accepted capability set
- accepted-at timestamp
- freshness timestamp tied to the accepted anchor or proof window

The minimum accepted assertion set is:

- `root_exists`
- `root_key_proof_verified`
- `live_signature_verified`

Optional but useful derived assertions:

- `anchor_fresh_enough`
- `owner_signed_updates_verified`

The minimum accepted capability set is:

- `club_attach_allowed`

The public-v0 capability set must also explicitly include:

- `pirate_subspace_issuance_allowed = false`

Naming convention:

- `club_attach_allowed` is the shared cross-family attach capability name
- `pirate_subdomain_issuance_allowed` remains the HNS-specific subordinate-issuance capability name
- `pirate_subspace_issuance_allowed` is the Spaces-specific subordinate-issuance capability name
- subordinate-issuance capability should not live in one shared fixed session or verification column across families

## Verification Principle

Spaces verification should prove two different facts:

1. the submitted `@space` currently resolves to a particular on-chain public key under an accepted trust anchor
2. the creator can produce a fresh signature with that same current key during the active Pirate session

Do not treat either fact as sufficient on its own.

Rationale:

- a Merkle proof without a fresh signature proves the state but not session-bound control
- a signature without a verified proof proves key possession but not that the key is still the current owner of the root

## Public V0 Dependencies

The minimum external dependency set is:

- a `spaced`-compatible provider that can return accepted root anchors
- a `spaced`-compatible provider that can return a Merkle proof for the target space
- Pirate-side verification using the Spaces verifier

Recommended implementation shape:

- fetch `get_root_anchors`
- fetch `get_space`
- fetch `prove_spaceout` or `prove_space_outpoint`
- verify the proof against one of the accepted anchors
- extract the current root public key from the verified proof
- issue a session-bound challenge
- verify a Schnorr signature for that challenge using the extracted public key

## Session Model

Pirate should model Spaces verification as an explicit session.

Suggested session states:

- `draft`
- `inspecting`
- `challenge_required`
- `challenge_pending`
- `verifying`
- `verified`
- `failed`
- `expired`
- `disputed`

Meaning:

- `draft`
  Session created but root inspection not yet started.
- `inspecting`
  Pirate is normalizing the submitted root, loading anchors, fetching a proof, and checking whether the root exists under an accepted anchor.
- `challenge_required`
  Pirate has a valid current root proof and is ready to issue a session-bound signing challenge.
- `challenge_pending`
  Pirate issued a challenge and is waiting for the creator to return a signature.
- `verifying`
  Pirate is checking the returned signature, optionally rechecking proof freshness, and deriving accepted assertions and capabilities.
- `verified`
  Pirate accepted the evidence and issued `namespace_verification_id`.
- `failed`
  The session cannot succeed without user correction or restart.
- `expired`
  The challenge or accepted session aged out and must be redone.
- `disputed`
  Pirate has contradictory evidence such as a transferred root, stale-anchor contradiction, or signature mismatch on a supposedly fresh proof path.

Unlike HNS, Spaces verification should not require a `dns_setup_required` state.

## Session Fields

Suggested Spaces verification-session fields:

- `namespace_verification_session_id`
- `namespace_verification_id` nullable until accepted
- `user_id`
- `family`
- `submitted_root_label`
- `normalized_root_label` nullable until inspection succeeds
- `status`
- `challenge_kind`
- `challenge_payload_json`
- `challenge_expires_at`
- `root_exists`
- `root_key_proof_verified`
- `live_signature_verified`
- `anchor_height`
- `anchor_block_hash`
- `anchor_root_hash`
- `proof_root_hash`
- `club_attach_allowed`
- `control_class`
- `operation_class`
- `observation_provider`
- `evidence_bundle_ref`
- `failure_reason`
- `accepted_at`
- `expires_at`
- `created_at`
- `updated_at`

`namespace_verification_id` is only populated when the session reaches `verified`.

Challenge convention:

- shared session storage should not hardcode HNS TXT-only fields or Spaces digest-only fields
- use `challenge_kind` plus `challenge_payload_json` for family-specific challenge material
- HNS challenge details such as `challenge_host` and `challenge_txt_value` become HNS payload fields
- Spaces challenge details such as message, digest, and signing-domain metadata become Spaces payload fields
- existing HNS rows may still carry `challenge_host` and `challenge_txt_value` as legacy denormalized fields until HNS writers are migrated

## Recommended Public V0 Order

1. inspect the submitted root
2. fetch anchors and a current proof for the root
3. verify that proof and extract the current root public key
4. issue a session-bound challenge
5. verify a creator-provided signature against the extracted public key
6. issue `namespace_verification_id` if the remaining policy checks pass

Rollout note:

- Spaces and HNS are separate verification families and must keep separate user instructions
- Pirate may host both verifier runtimes on the same VPS to save cost
- sharing a host does not imply sharing proof mechanics, state interpretation, or frontend UX

## Flow

### 1. Start Session

The creator starts a Spaces verification session for a candidate root.

Input:

- `family = spaces`
- root label as entered by the user, such as `@kanye`

Server actions:

- bind the session to the authenticated creator
- normalize the root label
- reject labels that are not valid top-level Spaces roots

Frontend rule:

- the Spaces start flow must never ask the user to set `NS`, `TXT`, or other DNS records
- Spaces verification is a root-proof plus fresh-signature flow, not a DNS-delegation flow

### 2. Inspect Root

Pirate inspects the normalized Spaces root through an accepted provider.

Inspection must determine:

- the root exists or not
- the provider can return an accepted anchor set
- the provider can return a Merkle proof for the current root state
- the proof verifies against one of the accepted anchors
- the verified proof resolves to a current public key for the root

Outcomes:

- if the root does not exist, fail the session
- if anchors cannot be fetched or the proof does not verify, fail closed
- if inspection succeeds, set `root_exists = true`, `root_key_proof_verified = true`, and issue a signing challenge

Important:

- inspection should use a freshness window for accepted anchors
- recommend accepting anchors only when the newest accepted anchor used for the proof is roughly within a 4-to-24-hour freshness window relative to verification time
- the exact threshold remains implementation-tunable, but Pirate should reject obviously stale provider snapshots

### 3. Issue Signing Challenge

Pirate issues a session-bound signing challenge for the current root key.

The challenge should include:

- a human-readable challenge message
- the exact digest Pirate expects to be signed
- challenge expiration time

Recommended value shape:

- a session-bound nonce such as `pirate-space-verify=<session-or-nonce>`

Do not use a static root-only challenge such as `pirate-space-verify=@kanye`.

Rationale:

- a static challenge is replayable
- Pirate needs fresh creator-bound proof for the current session

The frontend should display the challenge payload returned by the API and ask the user to sign that exact message or digest with the current root key.

### 4. Receive Signature

The creator signs the challenge using the current key that controls the verified Spaces root.

Pirate should accept:

- a compact Schnorr signature payload
- optional client metadata describing which wallet or signer surface was used

Pirate should not trust client-reported public keys when verifying the session.

The public key used for verification must come from the previously verified root proof.

### 5. Verify Signature Against Verified Root Key

After receiving the signature, Pirate verifies:

- the session challenge has not expired
- the signature is valid for the session digest
- the signature matches the root public key extracted from the verified proof
- the proof is still acceptable inside the freshness policy

Successful verification sets:

- `live_signature_verified = true`

If proof freshness or provider consistency requires non-trivial follow-up work, the session may enter `verifying` before acceptance. If the checks are immediate, the session may move directly to `verified` or `failed`.

Failure should preserve inspectable context:

- invalid signature
- wrong signer
- expired challenge
- stale or contradictory proof
- provider unavailable

Recommended frontend completion sequence:

1. start `family = spaces` namespace verification
2. read the signing challenge from the session payload
3. request a signature from the current Spaces root key
4. call `POST /namespace-verification-sessions/{id}/complete` with `signature_payload`
5. if the session challenge expires, call the same completion endpoint with `restart_challenge = true` to mint a fresh challenge

### 6. Evaluate Assertions

After proof and signature checks succeed, Pirate evaluates the Spaces assertion set:

- `root_exists`
- `root_key_proof_verified`
- `live_signature_verified`
- optional `anchor_fresh_enough`
- optional `owner_signed_updates_verified`

The minimum acceptance rule for public v0 is:

- `root_exists = true`
- `root_key_proof_verified = true`
- `live_signature_verified = true`
- creator identity policy for club creation is satisfied

### 7. Derive Capabilities

Pirate derives capability outputs from the accepted Spaces assertions.

Public-v0 capability rules:

- `club_attach_allowed = creator_unique_human_verified && root_key_proof_verified && live_signature_verified`
- `owner_signed_record_updates_allowed = false` unless Pirate explicitly implements owner-signed update transport and verification
- `pirate_subspace_issuance_allowed = false`

Important:

- a successful root verification is enough to attach `/c/@space`
- it is not enough to turn on Pirate-managed `name@space` issuance

### 8. Accept Verification

When the session passes the acceptance rule, Pirate should:

- issue `namespace_verification_id`
- persist the accepted evidence bundle reference
- persist the accepted assertion set
- persist the accepted capability set
- set an expiration or revalidation timestamp based on anchor freshness policy

## Evidence Bundle

Pirate should persist a Spaces evidence bundle that allows later audit and revalidation.

Recommended evidence components:

- submitted root and normalized root
- provider identity
- observation timestamp
- accepted anchor height
- accepted anchor block hash
- accepted anchor root hash
- raw or referenced proof payload
- proof hash
- derived current public key
- challenge message or digest
- returned signature
- evidence hash

Implementation convention:

- `resolver_path_json` and `raw_response_json` in the current evidence-bundle table are legacy HNS-shaped names
- Spaces evidence may still use those generic JSON fields for provider path metadata, anchor data, proof data, and raw verifier payloads

Recommended evidence kinds:

- `inspection_snapshot`
- `txt_observation`
- `delegation_snapshot`
- `anchor_snapshot`
- `space_proof_snapshot`
- `challenge_signature`
- `accepted_snapshot`
- `revalidation_snapshot`

## Failure Reasons

Suggested session failure reasons:

- `invalid_root`
- `root_not_found`
- `anchor_provider_unavailable`
- `anchor_set_stale`
- `proof_not_verifiable`
- `proof_root_mismatch`
- `challenge_not_signed`
- `invalid_signature`
- `wrong_signer`
- `creator_not_unique_human_verified`
- `session_expired`
- `contradictory_root_evidence`

These codes are implementation guidance, not a locked public enum.

## API Shape

The API should expose Spaces verification as explicit session workflows under the verification or namespace-verification surface.

Minimum operations:

1. start Spaces namespace verification session
2. inspect Spaces namespace verification session
3. complete or refresh Spaces namespace verification session after the creator signs the issued challenge
4. inspect accepted verification by `namespace_verification_id`

The path family may stay shared with HNS, but the write model must preserve:

- the session concept
- the accepted verification reference
- a family-specific challenge payload
- a family-specific evidence bundle

The shared path shape is acceptable only if the frontend still branches hard by family:

- HNS shows DNS or delegation setup
- Spaces shows proof and signature UX

## Revalidation

Accepted Spaces verification is not permanent.

Pirate should support revalidation triggers such as:

- manual refresh
- scheduled refresh
- create-time recheck
- contradiction detected
- suspected transfer

Revalidation should inspect:

- current root proof under current accepted anchors
- whether the current public key still matches the accepted state
- whether a fresh signature is required for the attempted action

## After HNS

Recommended delivery sequence:

1. make HNS work first with authoritative DNS, TXT verification, and native HNS routing
2. keep the frontend family split explicit while HNS is the first live public-v0 path
3. then enable Spaces on the same VPS using the proof-plus-signature verifier runtime
4. keep the API surface shared where it is already shared, but preserve family-specific UX and evidence handling

Recommended downgrade rules:

- stale anchor window without contradiction:
  mark the verification stale and block new community creation until refreshed
- root proof no longer matches accepted current key:
  mark disputed or expired depending on the cause
- contradictory proof indicating transfer:
  mark disputed and disable all Spaces-derived attach capability

## API and Schema Implication

Pirate's current control-plane migration and API schema are HNS-shaped:

- `family` currently allows only `hns`
- `namespace_verification_sessions` and `namespace_verifications` both carry HNS-only fixed assertion and capability columns
- challenge storage is HNS TXT-shaped rather than family-generic
- assertion, evidence-kind, and revalidation-trigger CHECK constraints are HNS-only

That means public-v0 Spaces verification is blocked less by cryptography than by Pirate's internal namespace-verification shape.

### Chosen Generalization Strategy

Recommended direction:

- keep only family-agnostic convenience fields denormalized on `namespace_verification_sessions` and `namespace_verifications`
- make assertion and capability records the canonical source for family-specific verification state
- use a generic challenge payload shape rather than parallel HNS and Spaces fixed columns

This is intentionally not the "add more nullable fixed columns forever" approach.

Rationale:

- it avoids schema sprawl for every new namespace family
- it keeps shared reads cheap for the few truly shared fields
- it preserves queryable assertion rows rather than burying everything in one opaque JSON blob

### Required Session and Verification Shape

After generalization, both `namespace_verification_sessions` and `namespace_verifications` should retain only shared fields such as:

- identifiers
- `user_id`
- `family`
- submitted and normalized root labels
- status
- `challenge_kind` nullable on sessions
- `challenge_payload_json` nullable on sessions
- `challenge_expires_at` nullable on sessions
- `root_exists` as an optional convenience projection
- `club_attach_allowed` as the shared capability projection
- `control_class`
- `operation_class`
- `observation_provider`
- `evidence_bundle_ref`
- `failure_reason` on sessions
- accepted and lifecycle timestamps

`root_exists` convention:

- on `namespace_verification_sessions`, `root_exists` remains an optional convenience projection
- on `namespace_verifications`, `root_exists` should still be populated for every accepted row
- for Spaces rows, set `root_exists = true` when the accepted `root_exists` assertion is true

The following HNS-specific fixed columns should be treated as legacy denormalization to retire in a future migration rather than patterns to extend:

- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`
- `pirate_web_routing_allowed`
- `pirate_subdomain_issuance_allowed`

Important:

- this applies to both `namespace_verification_sessions` and `namespace_verifications`
- Spaces should not add sibling fixed columns such as `live_signature_verified` or `pirate_subspace_issuance_allowed` to those tables

### Canonical Assertion and Capability Storage

`namespace_verification_assertions` should become the canonical store for family-specific assertions.

Assertion rows are family-scoped through their parent session or accepted verification.
If the schema persists `family` directly on assertion rows, that direct value should match the parent row.

Recommended merged `assertion_name` set:

- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`
- `root_key_proof_verified`
- `live_signature_verified`
- `anchor_fresh_enough`
- `owner_signed_updates_verified`

Recommended follow-on addition:

- add `namespace_verification_capabilities` as a sibling canonical table with `capability_name`, `capability_value`, source evidence, status, and timestamps

Capability rows are family-scoped through their parent session or accepted verification.
If the schema persists `family` directly on capability rows, that direct value should match the parent row.

Recommended merged `capability_name` set:

- `club_attach_allowed`
- `pirate_web_routing_allowed`
- `pirate_subdomain_issuance_allowed`
- `owner_signed_record_updates_allowed`
- `pirate_subspace_issuance_allowed`

Convention:

- `club_attach_allowed` is the only attach capability that should be denormalized cross-family
- subordinate issuance remains protocol-specific at the capability-record layer
- if a later cross-family convenience projection is needed, name it `pirate_managed_issuance_allowed`, but do not block public v0 on that extra projection

### Evidence and Revalidation Enum Expansion

Recommended merged `evidence_kind` set:

- `inspection_snapshot`
- `txt_observation`
- `delegation_snapshot`
- `anchor_snapshot`
- `space_proof_snapshot`
- `challenge_signature`
- `accepted_snapshot`
- `revalidation_snapshot`

Recommended merged revalidation `trigger` set:

- `manual_refresh`
- `scheduled_refresh`
- `create_time_recheck`
- `delegation_change`
- `expiry_change`
- `suspected_transfer`
- `contradiction_detected`

Not every merged trigger applies to every family:

- `delegation_change` and `expiry_change` remain HNS-oriented
- `suspected_transfer` is especially relevant to Spaces

### Challenge Storage Decision

Challenge details should not stay in family-specific fixed columns.

Recommended session shape:

- `challenge_kind` such as `dns_txt` or `schnorr_sign`
- `challenge_payload_json` for family-specific challenge material
- `challenge_expires_at`

Examples:

- HNS payload includes record host and TXT value
- Spaces payload includes human-readable challenge message, digest, and any signing-domain metadata Pirate requires
- the old `challenge_host` and `challenge_txt_value` columns become legacy HNS compatibility fields rather than the target write path

### Denormalization Rule

`root_exists` appears both as an assertion and as a session or verification convenience column.

This denormalization is intentional:

- assertion rows remain canonical
- the session and verification column is a cached projection for common read paths

The same rule may apply to `club_attach_allowed`.

Backfill convention:

- existing HNS accepted verifications may be backfilled into the canonical capability table from legacy fixed columns
- new Spaces writes should use the canonical capability table from day one rather than introducing new fixed verification columns

## Open Questions

- which anchor providers are acceptable for public v0 beyond a single `spaced`-compatible source
- whether `owner_signed_record_updates_allowed` should remain hard-false in the first Spaces launch
- what revalidation cadence Pirate should enforce once a community is already attached
- what governance or membership threshold should gate a future transition from `pirate_subspace_issuance_allowed = false` to any broader issuance model

## Public V0 Non-goals

This flow does not define:

- Pirate-managed `name@space` issuance
- delegated-handle certificate acceptance
- public sale or claim of subspaces
- multisig or DAO-specific Spaces signing UX
- message-bundle verification for owner-signed off-chain records

Those can be layered later without changing the core phase-1 goal:

- verify `@space`
- attach the community
- grow the community first
