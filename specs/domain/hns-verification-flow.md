# HNS Verification Flow

Status: draft

Related docs:

- [namespace-root-control.md](./namespace-root-control.md)
- [namespace.md](./namespace.md)
- [community.md](./community.md)
- [public-v0-club-enforcement.md](./public-v0-club-enforcement.md)
- [../api/overview.md](../api/overview.md)

## Purpose

This doc defines the concrete public v0 HNS verification lifecycle that produces `namespace_verification_id`.

It exists to make the `Create-Community Handoff` in [namespace-root-control.md](./namespace-root-control.md) implementable.

This flow is separate from:

- user identity verification such as `unique_human` or `age_over_18`
- community creation itself
- later Pirate-managed subdomain claim or sale flows

## Public V0 Scope

Public v0 namespace verification supports:

- `family = hns`
- verification of a root for club attachment
- classification of routing and delegation capability
- issuance of a server-trusted `namespace_verification_id`

Public v0 namespace verification does not itself:

- create a club
- enable subdomain sales
- imply that Pirate has subdomain authority
- replace later namespace revalidation

## Core Outputs

Successful HNS verification must produce:

- `namespace_verification_id`
- normalized root label
- creator binding
- accepted evidence bundle reference
- accepted assertion set
- accepted capability set
- accepted-at timestamp
- expiry or freshness timestamp

The minimum accepted assertion set is:

- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- optional `routing_enabled`
- optional `pirate_dns_authority_verified`

The minimum accepted capability set is:

- `club_attach_allowed`
- optional `pirate_web_routing_allowed`
- optional `pirate_subdomain_issuance_allowed`

## Session Model

Pirate should model HNS verification as an explicit session.

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
  Pirate is normalizing the root and checking existence and expiry.
- `challenge_required`
  The root exists and Pirate has generated a TXT challenge the creator must publish.
- `challenge_pending`
  Pirate is waiting for the TXT challenge to become visible.
- `verifying`
  Pirate has observed a candidate-successful TXT response and is performing final cross-checks, expiry and delegation reads, and assertion derivation before acceptance.
- `verified`
  Pirate accepted the evidence and issued `namespace_verification_id`.
- `failed`
  The session cannot succeed without user correction or restart.
- `expired`
  The challenge or accepted session aged out and must be redone.
- `disputed`
  Pirate has contradictory evidence or takeover evidence and must not trust the session.

Important:

- `verifying` is primarily a backend session state
- clients do not need to render `challenge_pending` and `verifying` as distinct UX states
- if cross-checking is effectively immediate, an implementation may transition directly from `challenge_pending` to `verified` or `failed` without exposing `verifying` as a visible client state

## Session Fields

Suggested HNS verification-session fields:

- `namespace_verification_session_id`
- `namespace_verification_id` nullable until accepted
- `user_id`
- `family`
- `submitted_root_label`
- `normalized_root_label` nullable until inspection succeeds
- `status`
- `challenge_host` nullable
- `challenge_txt_value` nullable
- `challenge_expires_at` nullable
- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`
- `control_class` nullable
- `operation_class` nullable
- `evidence_bundle_ref` nullable
- `failure_reason` nullable
- `accepted_at` nullable
- `expires_at`
- `created_at`
- `updated_at`

`namespace_verification_id` is only populated when the session reaches `verified`.

## Flow

### 1. Start Session

The creator starts an HNS verification session for a candidate root.

Input:

- `family = hns`
- root label as entered by the user

Server actions:

- bind the session to the authenticated creator
- normalize the root label
- reject obviously invalid labels before deeper inspection

### 2. Inspect Root

Pirate inspects the normalized HNS root across accepted resolver paths.

Inspection must determine:

- root exists or not
- current expiry or remaining lifetime
- whether the root already routes traffic to Pirate
- whether authoritative delegation to Pirate is present

Outcomes:

- if the root does not exist, fail the session
- if expiry horizon is insufficient, continue recording the fact but do not allow club attachment later
- if existing Pirate routing or delegation is detected, record it as evidence during inspection but do not treat it as fresh creator-bound control proof
- if inspection succeeds, generate a TXT challenge

### 3. Issue TXT Challenge

Pirate issues a TXT challenge for root-control proof.

The challenge should include:

- exact record host
- exact TXT value
- challenge expiration time

That challenge expiry should be modeled separately from the overall session expiry so clients and operators can distinguish "publish a new TXT challenge" from "start a new verification session."

Pirate should treat the challenge as single-use or tightly scoped to the current session.

### 4. Observe TXT Control

Once the creator publishes the TXT record, Pirate verifies it.

For public v0, Pirate may verify the TXT challenge, expiry view, and delegation state through one trusted HNS-aware provider such as Fire HSD.

Pirate should:

- record the provider identity in the evidence bundle
- record the observation timestamp
- store the raw response snapshot or an equivalent evidence reference
- fail closed if the provider is unavailable or returns inconsistent data for the requested root

Multi-source cross-checking or self-hosted HNS infrastructure is a later hardening path, not a public-v0 requirement.

Successful observation of the TXT challenge sets:

- `root_control_verified = true`

If cross-checking, delegation reads, or assertion derivation require non-trivial follow-up work, the session may enter `verifying` before acceptance. If those checks are immediate, the session may move directly to acceptance or failure.

Failure should preserve inspectable context:

- challenge not yet propagated
- challenge missing
- wrong TXT value
- resolver disagreement

### 5. Evaluate Assertions

After TXT control succeeds, Pirate evaluates the HNS assertion set:

- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`

These assertions must remain separate. A session may be valid for club attachment even when Pirate DNS delegation is absent.

Existing Pirate delegation does not waive fresh creator-bound root-control proof for a new verification session. Delegation is operational evidence, not creator binding.

### 6. Derive Capabilities

Capabilities are derived exactly as described in [namespace-root-control.md](./namespace-root-control.md):

- `club_attach_allowed = creator_unique_human_verified && root_control_verified && expiry_horizon_sufficient`
- `pirate_web_routing_allowed = root_control_verified && routing_enabled`
- `pirate_subdomain_issuance_allowed = root_control_verified && expiry_horizon_sufficient && pirate_dns_authority_verified`

Important:

- `pirate_subdomain_issuance_allowed` is technical capability only
- public `name.root` claim or sale flows still require product permission from club stage and policy

### 7. Accept Verification

Pirate may accept the session only when:

- the creator's `unique_human` verification is currently accepted
- `root_control_verified = true`
- `expiry_horizon_sufficient = true`

If accepted:

- issue `namespace_verification_id`
- persist the accepted evidence bundle and assertions
- set `status = verified`

Delegation to Pirate is not required for club attachment. It is only required for later Pirate-managed subdomain issuance.

Previously accepted verification may be reused only when all of the following are true:

- the accepted verification is for the same normalized root
- the accepted verification is bound to the same creator
- the accepted verification is still fresh and not stale, disputed, or expired

If those conditions are not met, Pirate must require a fresh TXT-based control proof even when routing or delegation to Pirate is already present.

## Create-Community Binding

`POST /communities` must consume `namespace_verification_id`, not raw namespace proof.

At create time, the server must re-check that:

- the verification belongs to the requesting creator
- the verification is still accepted and not stale, disputed, or expired
- the underlying HNS assertions still satisfy `club_attach_allowed`

If these checks fail, create must be rejected before any club state is written.

## Freshness And Revalidation

Accepted HNS verification is not permanent.

Pirate should support at least:

- challenge expiration before acceptance
- accepted-session expiration or revalidation window
- manual or scheduled revalidation after acceptance
- capability downgrade when delegation or expiry changes

Recommended product consequences:

- stale or disputed verification blocks new community creation
- expiry drifting below the accepted horizon blocks new paid namespace sales before it disables an existing club route
- delegation loss disables new Pirate-managed namespace claims without necessarily detaching the club

## Failure Reasons

Suggested session failure reasons:

- `invalid_root`
- `root_not_found`
- `challenge_not_published`
- `challenge_mismatch`
- `resolver_disagreement`
- `expiry_horizon_insufficient`
- `creator_not_unique_human_verified`
- `session_expired`
- `contradictory_control_evidence`

These codes are implementation guidance, not a locked public enum.

## API Shape

The API should expose HNS verification as explicit session workflows under the verification or namespace-verification surface.

Minimum operations:

1. start HNS namespace verification session
2. inspect HNS namespace verification session
3. refresh or complete HNS namespace verification session after TXT publication
4. inspect accepted verification by `namespace_verification_id`

The exact path family may remain flexible, but the write model must preserve the session concept and the accepted verification reference.

## Non-Goals

This doc does not define:

- the exact HTTP paths or schemas
- the exact HNS resolver vendor mix
- browser UX for TXT setup
- later Pirate-managed HNS subdomain sale flows
- Spaces verification
