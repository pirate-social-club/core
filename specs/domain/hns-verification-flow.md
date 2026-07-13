# HNS Verification Flow

Status: current working spec

Related docs:

- [namespace-root-control.md](./namespace-root-control.md)
- [hns-authoritative-dns.md](./hns-authoritative-dns.md)
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

See [hns-authoritative-dns.md](./hns-authoritative-dns.md) for the DNS prerequisite and deployment model behind the public v0 TXT proof path.

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
- `dns_setup_required`
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
  Pirate is normalizing the root and checking existence, expiry, and whether TXT proof prerequisites are present.
- `dns_setup_required`
  The root passed basic inspection, but the selected TXT proof path cannot continue until the creator sets up working authoritative DNS for the root.
- `challenge_required`
  The TXT proof path is available and Pirate is ready to issue, or has just issued, a TXT challenge for the creator to publish.
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
- clients do not need to render `dns_setup_required`, `challenge_pending`, and `verifying` as fully distinct polished UX phases if a simpler "continue setup" experience is sufficient
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
- `ownership_source` nullable — which assertion-1 evidence path proved control:
  `hns_parent_chain_txt` (Pirate-managed) or `owner_authoritative_dns_txt`
  (owner-managed)
- `authority_health_verified` nullable — assertion-3 outcome after Pirate
  provisions the child zone; gates routing claims, never acceptance
- `control_class` nullable
- `operation_class` nullable
- `evidence_bundle_ref` nullable
- `failure_reason` nullable
- `accepted_at` nullable
- `expires_at`
- `created_at`
- `updated_at`

`namespace_verification_id` is only populated when the session reaches `verified`.

Evidence migration rule: sessions created before the assertion split carry
`root_control_verified` under the older mixed semantics and have
`ownership_source` and `authority_health_verified` as null. Consumers must
treat null as "legacy evidence, assertion provenance unknown" — never backfill
or reinterpret old sessions as if they had passed the split assertions.

## Recommended Public V0 Order

1. inspect the root
2. issue a session-bound nonce; the owner publishes it as parent root-resource
   TXT (Pirate-managed path, optionally alongside `NS`/glue delegation in the
   same update) or at `_pirate.<root>` on their own authoritative DNS
   (owner-managed path)
3. observe ownership from owner-published evidence only; observe delegation
   independently from parent-chain data
4. allow community creation if ownership plus the remaining checks pass
5. Pirate-managed path only: provision the child zone, publish
   `_pirate.<root>`, and record `authority_health_verified` from a
   serving-path query
6. optionally let the owner move the root to or from Pirate-managed
   nameservers later, subject to revalidation

Public-v0 implementation note:

- the protocol model allows either owner-managed authoritative DNS or Pirate-managed authoritative DNS
- the product should still ship one path first
- if Pirate ships Pirate-managed authoritative DNS first, the frontend must ask the user to publish only Handshake parent delegation records in their HNS root-management tool and must not imply that a parent-side TXT value alone satisfies `_pirate.<root>` after delegation
- the recommended Pirate-managed implementation is PowerDNS Authoritative plus API-backed zone provisioning

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
- whether the root already has working authoritative DNS
- whether the root already routes traffic to Pirate
- whether authoritative delegation to Pirate is present

For the Pirate-managed path, inspection should also determine whether Pirate has already provisioned
the delegated child zone in its authoritative backend.

Outcomes:

- if the root does not exist, fail the session
- if expiry horizon is insufficient, continue recording the fact but do not allow club attachment later
- if the root lacks working authoritative DNS, move the session to `dns_setup_required` and do not issue a subdomain TXT challenge yet
- if existing Pirate routing or delegation is detected, record it as evidence during inspection but do not treat it as fresh creator-bound control proof
- if inspection succeeds, generate a TXT challenge

Expiry is an independent chain assertion. Pirate must not infer
`expiry_horizon_sufficient = true` from root existence, resource existence, successful TXT control,
or delegation. The verifier must record the expiry height, observed chain-tip height, hash, time,
and network, remaining blocks, configured minimum-horizon blocks, and observation provider.
Missing, unavailable, stale, malformed, wrong-network, or unanchored expiry evidence yields
`expiry_horizon_sufficient = null`, which fails closed for every expiry-gated capability.

### 3. Issue TXT Challenge

Pirate issues a TXT challenge for root-control proof.

The challenge should include:

- exact record host
- exact TXT value
- challenge expiration time

Recommended public v0 host:

- `_pirate.<root>`

Prerequisite:

- `_pirate.<root>` can only exist if the root already has working authoritative DNS
- therefore, if the current proof method is TXT at `_pirate.<root>`, the creator must first set up authoritative DNS for the root before this step can succeed
- Pirate-managed nameserver delegation is not required for this step and should normally not happen before creator-bound TXT proof completes

Delegation clarification (see the Verification Assertions section of
[hns-authoritative-dns.md](./hns-authoritative-dns.md)):

- if the user chooses Pirate-managed nameservers, the ownership challenge is
  the session nonce published by the owner as a TXT value in the Handshake
  parent root resource — on-chain evidence, not DNS `_pirate.<root>` proof.
  The same root-resource update can carry the `NS`/glue delegation records.
- `_pirate.<root>` in Pirate's hosted `<root>.` zone is written by Pirate
  after ownership and delegation pass, and is only ever authority-health
  evidence. Pirate must never verify ownership against a record Pirate itself
  published.
- if the user stays owner-managed, the challenge is `_pirate.<root>` served by
  their own authoritative DNS, observed through independent resolvers.

That challenge expiry should be modeled separately from the overall session expiry so clients and operators can distinguish "publish a new TXT challenge" from "start a new verification session."

Pirate should treat the challenge as single-use or tightly scoped to the current session.

Recommended public v0 value shape:

- a session-bound nonce such as `pirate-verify=<session-or-nonce>`

Do not use a static root-only value such as `pirate-verify=<root>` because it is replayable and does not prove fresh creator-bound control for the current session.

### 4. Observe TXT Control

Once the creator publishes the TXT record, Pirate verifies it.

For public v0, Pirate may inspect Handshake parent-state such as expiry, `NS`, and glue through one
trusted HNS-aware provider such as Fire HSD.

The v0 expiry path uses authenticated hsd JSON-RPC: `getnameinfo` supplies
`stats.renewalPeriodEnd`, while `getblockchaininfo` supplies the chain-tip height and hash anchoring
the calculation. The minimum acceptable remaining lifetime is explicit deployment policy, not a
hardcoded verifier guess.

Ownership observation must come from evidence the owner published, split by path:

- Pirate-managed: the session TXT value is read from the Handshake parent root
  resource (`ownership_source = hns_parent_chain_txt`); parent inspection also
  yields the delegation assertion (`NS`/glue pointing at Pirate nameservers)
- owner-managed: `_pirate.<root>` is read from the owner's authoritative DNS
  through independent resolvers (`ownership_source = owner_authoritative_dns_txt`)
- Pirate must never read ownership evidence from its own authoritative
  backend or its own hosted zones — that path exists only for the
  authority-health assertion after provisioning

Pirate should:

- record the provider identity in the evidence bundle
- record the observation timestamp
- store the raw response snapshot or an equivalent evidence reference
- fail closed if the provider is unavailable or returns inconsistent data for the requested root

Multi-source cross-checking or self-hosted HNS infrastructure is a later hardening path, not a
public-v0 requirement.

Successful observation of the TXT challenge sets:

- `root_control_verified = true`

If cross-checking, delegation reads, or assertion derivation require non-trivial follow-up work, the session may enter `verifying` before acceptance. If those checks are immediate, the session may move directly to acceptance or failure.

Failure should preserve inspectable context:

- challenge not yet propagated
- challenge missing
- wrong TXT value
- resolver disagreement

For the Pirate-managed path, the post-acceptance authority-health check (and
only that check) queries `_pirate.<root>` against the delegated authoritative
zone Pirate is actually serving, recording `authority_health_verified`.

### 5. Evaluate Assertions

After TXT control succeeds, Pirate evaluates the HNS assertion set:

- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`

These assertions must remain separate. A session may be valid for club attachment even when Pirate DNS delegation is absent.

Existing Pirate delegation does not waive fresh creator-bound root-control proof for a new verification session. Delegation is operational evidence, not creator binding.

## Frontend Contract

The frontend flow should stay explicit and family-specific.

Recommended HNS client sequence:

1. Start `family = hns` namespace verification.
2. Read the returned session state.
3. If the session is `dns_setup_required`, show DNS setup instructions and do not attempt completion yet.
4. After the user updates DNS, call `POST /namespace-verification-sessions/{id}/complete` with `restart_challenge = true`.
5. Re-read the session and show the current `_pirate.<root>` challenge details.
6. Once the DNS change has propagated, call the same completion endpoint without `restart_challenge`.
7. Use the returned `namespace_verification_id` for community creation only after the session reaches `verified`.

Frontend UX rules:

- HNS and Spaces must be presented as different protocol flows
- HNS setup may involve DNS records and delegation
- Spaces setup must never ask the user for DNS changes
- if Pirate-managed DNS is the only live public-v0 HNS path, the UI must say that clearly

Record-writing rules:

- if the user remains on owner-managed authoritative DNS, the frontend shows the `_pirate.<root>` TXT challenge they must publish on that authority
- if the user chooses Pirate-managed nameservers, the frontend shows one parent
  root-resource update: the session TXT value plus the `NS`/glue delegation
  records to set in their HNS root-management tool
- the frontend must never instruct the user to publish `_pirate.<root>` for
  the Pirate-managed path — Pirate writes that record itself after acceptance,
  as authority-health evidence only

## HNS-First Rollout Plan

The clearest path to "works natively for `infinity/` and is verifiable" is:

1. Ship HNS first.
2. Support one live path first: Pirate-managed authoritative DNS on the VPS.
3. Have the frontend generate one Handshake parent root-resource update:
   - the session-bound TXT value (ownership assertion)
   - `NS` and any required glue records (delegation assertion)
4. Observe ownership and delegation independently from parent-chain data, then
   issue `namespace_verification_id`.
5. Provision the child `<root>.` zone in Pirate's authoritative DNS backend and
   publish `_pirate.<root>` there.
6. Query `_pirate.<root>` through the serving path and record
   `authority_health_verified`.
7. Add owner-managed authoritative-DNS support only after the Pirate-managed path is operationally stable.

Implementation requirement:

- the zone provisioning step must not remain a hand-written static file workflow
- Pirate needs an automated authoritative child-zone path for arbitrary delegated roots before this rollout is complete

### 6. Derive Capabilities

Capabilities are derived exactly as described in [namespace-root-control.md](./namespace-root-control.md):

- `club_attach_allowed = creator_unique_human_verified && root_control_verified && expiry_horizon_sufficient`
- `pirate_web_routing_allowed = root_control_verified && routing_enabled`
- `pirate_subdomain_issuance_allowed = root_control_verified && expiry_horizon_sufficient && pirate_dns_authority_verified`

Important:

- `pirate_subdomain_issuance_allowed` is technical capability only
- public `name.root` claim or sale flows still require product permission from club stage and policy
- owner-managed authoritative DNS plus owner-managed routing may be enough for `routing_enabled = true` without granting Pirate DNS authority
- Pirate-managed nameserver delegation is a later optional step that may upgrade `pirate_dns_authority_verified`

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
