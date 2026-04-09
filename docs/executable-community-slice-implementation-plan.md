# Executable Community Slice Implementation Plan

Status: execution handoff

Related:

- [community-api-first-slice-freeze.md](/home/t42/Documents/pirate-v2/docs/community-api-first-slice-freeze.md)
- [account-creation-first-slice.md](/home/t42/Documents/pirate-v2/docs/account-creation-first-slice.md)
- [turso-data-boundaries.md](/home/t42/Documents/pirate-v2/docs/turso-data-boundaries.md)
- [turso-provisioning-contract.md](/home/t42/Documents/pirate-v2/docs/turso-provisioning-contract.md)
- [../db/README.md](/home/t42/Documents/pirate-v2/db/README.md)

## Purpose

Define the concrete implementation order for Pirate's first executable API-only community slice.

This plan assumes:

- this repo is the contract and migration source of truth
- runtime implementation may live elsewhere
- Bruno is the primary no-UI execution harness
- local development should prefer the smallest dependency set that still proves the real contract

## Scope

The executable slice is the one frozen in [community-api-first-slice-freeze.md](/home/t42/Documents/pirate-v2/docs/community-api-first-slice-freeze.md):

- auth exchange
- namespace verification
- community create plus provisioning
- post create and read

Out of scope for this plan:

- UI behavior
- MCP generation
- SDK generation before runtime proof
- broader MPP expansion
- full private Turso control-plane automation in the first local pass

## Non-Negotiable Boundaries

### Storage Boundary

Keep the documented split:

- central Turso control-plane database for identity, verification, community routing, credentials, jobs, and audit
- per-community database for community-owned durable state

Do not collapse community-owned posts, memberships, roles, or local handle policy into the control-plane DB for speed.

### Namespace Proof Boundary

`POST /communities` must consume an accepted `namespace_verification_id`, not raw namespace labels as proof.

### Async Contract Boundary

`POST /communities` remains an async contract even in local stub mode.

The current API source now models this as `202` with `CommunityCreateAcceptedResponse`, returning both:

- `community`
- `job`

Stub mode may resolve the job immediately, but the wire contract must remain pollable.

### Public/Private Authority Boundary

The public API runtime must not require `TURSO_PLATFORM_API_TOKEN`.

Even in local stub mode, do not fake the public/private boundary by importing platform credentials into the public worker path. Local stub provisioning should create local libSQL databases directly.

## Blocking Prerequisites

### 1. Migration Runner

The repo currently has no migration runner.

Before runtime work begins, provide one of:

- a small ordered migration command for `db/control-plane/migrations/`
- a small ordered migration command for `db/community-template/migrations/`
- or a documented manual apply sequence for local development

Preferred outcome:

- local command for control-plane migrations
- local command for community-template bootstrap

Current repo-local command:

```bash
rtk bash scripts/apply-sqlite-migrations.sh \
  --db /tmp/pirate-control-plane.db \
  --migrations db/control-plane/migrations \
  --label control-plane
```

### 2. JWT Contract

Lock both JWT layers before runtime implementation:

- upstream JWT verification contract for `jwt_based_auth`
- Pirate bearer-token issuance and verification contract

Minimum JWT details to lock:

- signing algorithm
- issuer
- audience
- `sub`
- expiration
- middleware or route-guard behavior for bearer verification

### 3. Fixture Strategy

Bruno cannot depend on a browser.

The first executable slice therefore needs explicit fixtures for:

- generating a valid upstream JWT
- creating or seeding an accepted `unique_human` capability
- creating or seeding a valid `namespace_verification_id`

The fixture plan is part of implementation, not an afterthought.

Current repo-local upstream JWT helper:

```bash
rtk bun scripts/mint-test-jwt.mjs \
  --issuer pirate-dev-upstream \
  --audience pirate-api \
  --subject user_demo_01 \
  --secret dev-upstream-secret
```

Current repo-local control-plane fixture seed helper:

```bash
rtk bash scripts/seed-control-plane-fixtures.sh \
  --db /tmp/pirate-control-plane.db \
  --user-id usr_demo_01 \
  --subject demo-subject-01 \
  --handle demo \
  --namespace-label demo
```

Current repo-local community bootstrap helper:

```bash
rtk bash scripts/bootstrap-community-db.sh \
  --db /tmp/pirate-community-demo.db \
  --community-id cmt_demo_01 \
  --user-id usr_demo_01 \
  --display-name "Demo Community" \
  --namespace-verification-id nv_demo_usr_demo_01 \
  --namespace-label demo
```

## Runtime Design Decisions

### Auth First, Privy Later

The first executable auth path is `jwt_based_auth`.

Privy remains a second upstream proof type later on the same normalized exchange route.

### Unique-Human Dependency

HNS namespace verification acceptance depends on prior accepted `unique_human` verification.

That dependency is runtime-enforced, not guaranteed by DB schema. In the first local pass, a seeded accepted attestation is acceptable if the full human-verification runtime is not implemented yet.

### Local Community DB Strategy

For local stub provisioning, use a separate local libSQL database per community.

Reason:

- keeps the central/community boundary real
- allows `POST /posts` and `GET /posts/{post_id}` to run end to end
- avoids blocking on the Turso Platform API

Do not use a fake "provisioning succeeded but no DB exists" stub if the goal is end-to-end proof of post write/read.

### Create-Time Derivations

Public-v0 create requires server-derived fields such as:

- `community_stage`
- `member_count`
- `qualified_member_count`
- `stage_entered_at`
- derived capability flags

These should be treated as read-model derivations, not as required writes into the current community-template schema unless and until a later schema explicitly stores them.

## Milestones

### Milestone 1: Account Slice

Implement:

- `POST /auth/session/exchange`
- `GET /users/me`
- `GET /onboarding/status`

Behavior:

- verify upstream JWT
- upsert central user identity rows
- create default profile and generated signup identity for new users
- issue Pirate bearer token
- verify Pirate bearer token on authenticated routes

Exit criteria:

- Bruno happy path works without a browser
- Bruno covers at least one auth failure case
- the same upstream proof is idempotent

### Milestone 2: Namespace Verification Shortcut For Faster Community Proof

Before the full HNS runtime exists, support a seeded or fixture-backed path that creates:

- accepted `unique_human`
- accepted `namespace_verification_id`

This milestone exists only to unblock end-to-end proof of community create and post flows faster.

Exit criteria:

- a Bruno-friendly path exists to obtain a valid `namespace_verification_id`
- fixture data is inspectable in the control-plane DB

### Milestone 3: Community Create + Inspection + Job Polling

Treat these as one milestone, not sequential independent tasks.

Implement together:

- `POST /communities`
- `GET /communities/{community_id}`
- `GET /jobs/{job_id}`

Entry point:

- seeded or fixture-backed accepted `namespace_verification_id`

Required server behavior:

- enforce public-v0 create restrictions
- reject `post_ephemeral` anonymous scope for ordinary public-v0 create
- re-check creator binding and freshness of `namespace_verification_id`
- enforce centralized governance only
- enforce `handle_policy.policy_template = standard`
- create central `communities` row
- create `community_provisioning` job row
- provision local per-community libSQL database in stub mode
- apply community-template schema
- seed bootstrap rows
- mark job succeeded in stub mode
- return `202` with `{ community, job }`

Required bootstrap rows:

- community row in the community DB
- owner membership
- owner role
- namespace binding
- namespace handle policy

Required seeded value:

- `artist_governance_state = fan_run` for centralized public-v0 communities

Idempotency rule:

- re-POST with the same accepted `namespace_verification_id` must return the existing `community` and the existing `job`

Exit criteria:

- Bruno can create a community and inspect it
- Bruno can poll the returned job
- Bruno can exercise at least one failure case for create or inspection
- idempotent re-POST returns the original community and job

### Milestone 4: Post Create + Read

Implement:

- `POST /posts`
- `GET /posts/{post_id}`

Behavior:

- writes target the provisioned per-community DB
- posts are only accepted after the community is usable
- retries use `idempotency_key`

Exit criteria:

- Bruno can create a post in the newly provisioned community
- Bruno can read it back
- Bruno can exercise at least one failure case

### Milestone 5: Full HNS Verification Runtime

After seeded verification unblocks the broader slice, implement the actual HNS flow:

- start namespace verification session
- inspect root
- issue TXT challenge
- refresh/complete session
- accept and mint `namespace_verification_id`

This flow must enforce prior accepted `unique_human`.

Exit criteria:

- Bruno can run the real namespace verification happy path
- Bruno can exercise at least one namespace verification failure path
- fixture shortcut may remain for faster local testing, but the real path must exist

### Milestone 6: Replace Stub Provisioning With Private Control-Plane Automation

Swap the local stub implementation behind the same public contract for real Turso provisioning:

- create Turso group
- create `main` database
- mint runtime token
- write encrypted credential metadata centrally
- apply community-template schema
- seed bootstrap rows

The public API contract must remain unchanged.

## Enforcement Checklist

The community-create runtime must explicitly enforce:

- `governance_mode = centralized`
- `membership_mode in {open, gated}`
- accepted `namespace_verification_id`
- creator owns that verification
- verification is fresh, not stale, not disputed, not expired
- `community_attach_allowed = true`
- `handle_policy.policy_template = standard`
- no token gates in public-v0 create
- no `viewer` or `posting` gate scopes in public-v0 create
- no public create-time donation policy configuration
- no public create-time bootstrap payload
- no ordinary public-v0 `post_ephemeral` anonymous scope
- accepted `unique_human`
- accepted `age_over_18` when `default_age_gate_policy = 18_plus`

## Error Surface

The runtime must implement the locked error surface from the freeze doc:

- `auth_error`
- `verification_required`
- `eligibility_failed`
- `gate_failed`
- `conflict`
- `not_found`
- `rate_limited`

Bruno failure coverage must exercise at least one failure case for each milestone, not only the happy path.

## OpenAPI And Route Discipline

The modular OpenAPI source remains the contract source of truth.

Required discipline:

- runtime routes must match the source spec
- `specs/api/openapi.yaml` must be rebundled from `specs/api/src/`
- verification must pass before milestone closure

Minimum check:

- run `rtk bun specs/api/scripts/verify-openapi.ts`

## Audit Artifacts

Each milestone should produce auditable artifacts:

- Bruno requests for the happy path
- Bruno requests for at least one failure path
- SQL queries showing expected durable rows
- explicit note of any fixture-seeded rows used to accelerate local proof

## Execution Order

1. migration runner
2. JWT contract for upstream verification and Pirate bearer issuance
3. account slice: exchange, users me, onboarding status
4. fixture strategy for upstream JWT, `unique_human`, and namespace verification shortcut
5. community create + inspection + job polling using seeded accepted verification
6. post create + read
7. Bruno failure coverage pass for all implemented steps
8. full HNS verification runtime
9. replace stub provisioning with private Turso control-plane automation

## Final Exit Condition

This plan is complete only when:

- the first executable slice can run end to end through Bruno without a browser
- at least one failure case exists for each implemented step
- the public async contract stays stable while local stub provisioning is replaced by real control-plane automation
- central/community storage boundaries remain intact
