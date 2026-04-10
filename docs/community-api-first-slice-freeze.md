# Community API First Slice Freeze

Status: locked for the first executable slice

## Scope

This document freezes the first executable community slice for Pirate:

- auth exchange
- namespace verification
- community create plus provisioning and registry publication
- post create and read

This repo remains contract-first, but this slice must be executable end to end. Everything outside this slice remains draft unless explicitly promoted later.

Terminology note:

- this document uses `community` as the generic product term
- the current API and schema surface also uses `community` identifiers and paths for the foundational unit
- product language may still refer to a smaller foundational unit as a club, but this freeze document follows the current API contract terminology

## Locked Contracts

The following contracts are stable for this slice:

- `POST /auth/session/exchange`
- `SessionExchangeResponse`
- `User`
- `WalletAttachmentSummary`
- namespace verification session start, inspect, complete, and accepted verification inspect
- `POST /communities`
- `Community`
- `Job`
- `POST /communities/{community_id}/posts`
- `GET /posts/{post_id}`
- `Post`

## Execution Order

The first slice is exercised in this order:

1. exchange upstream auth proof for a Pirate app session
2. start namespace verification
3. complete or refresh namespace verification until an accepted `namespace_verification_id` exists
4. create the foundational community unit through `POST /communities`
5. wait until infrastructure provisioning completes
6. wait until registry publication reaches a usable state
7. create a post
8. read the post back

## Locked Behavior

### Auth Exchange

- `POST /auth/session/exchange` is idempotent on upstream proof
- the server upserts the canonical user, auth-provider link, and wallet attachments
- when `wallet_address` is present, the server must resolve it against the linked upstream wallet set
- when `wallet_address` is absent, the server must choose the upstream default wallet if one exists
- when no linked wallet exists, the exchange still succeeds with a null primary wallet attachment

### Community Create And Provisioning

- `POST /communities` is idempotent on accepted `namespace_verification_id`
- one accepted namespace verification may create at most one foundational community unit
- the server must re-check the accepted namespace verification at write time
- the server must write a public create-attempt audit row before creating any operational community row
- if the public create-attempt audit write fails, `POST /communities` fails and no operational community is created
- community infrastructure provisioning is a distinct lifecycle from domain `Community.status`
- a `Community` may be domain-active while `provisioning_state` is still `provisioning`
- clients must not assume the community is usable until `provisioning_state = active`
- registry publication is a distinct lifecycle from both `Community.status` and `Community.provisioning_state`
- clients must not assume the community is publicly canonical or publicly discoverable until `registry_publication_state = published`
- `Community` must expose:
  - `registry_publication_state`
  - `registry_attempt_id`
  - `registry_published_at`
  - `registry_error_code`
- if a retried create finds an existing community whose latest provisioning job is `queued`, `running`, or `succeeded`, the server must return that existing `community` and `job`
- if a retried create finds an existing community whose latest provisioning job is `failed` and `provisioning_state != active`, the server may create a new provisioning job for the same community and return that new job

### Registry Publication

- registry publication is modeled as async work distinct from infrastructure provisioning
- the job type `community_registry_publication` is part of the locked public contract
- the initial registry publication flow must support these states:
  - `not_started`
  - `pending_create`
  - `pending_seed`
  - `published`
  - `stale`
  - `publication_error`
- `stale` means the community was previously published, but Tableland is behind accepted Turso-side registry-bearing mutations
- `publication_error` means current publication work failed and requires retry or operator intervention
- public discovery must exclude communities whose `registry_publication_state != published`
- an operationally usable community may exist while `registry_publication_state` is `pending_create`, `pending_seed`, or `publication_error`
- operational reads and operational-only writes may proceed before publication succeeds
- mutations whose effect must be reflected in the canonical public registry require `registry_publication_state = published`

### Async Provisioning

- community provisioning is modeled as async work
- the exposed poll shape is `/jobs/{job_id}`
- the provisioning job type is `community_provisioning`
- registry publication also uses the pollable `/jobs/{job_id}` shape
- `CommunityCreateAcceptedResponse.job` is the provisioning job
- `Community.registry_publication_job_id` points at the distinct registry-publication job when one exists
- local development may use a synchronous stub that immediately marks the community active, but the public contract still assumes the pollable async shape

### Post Create

- post creation in this slice assumes an already-usable foundational community unit
- retries must not require clients to guess whether the community is still provisioning
- post creation is an operational write and does not require `registry_publication_state = published`
- `CreatePostRequest` requires `idempotency_key`
- for the same authenticated author, retrying the same create with the same `idempotency_key` must return the originally created post rather than creating a duplicate

## Locked Error Surface

The following machine-readable error codes are locked for this slice:

- `auth_error`
- `verification_required`
- `eligibility_failed`
- `gate_failed`
- `conflict`
- `not_found`
- `rate_limited`

HTTP status mappings for those errors are part of the locked contract.

## Bruno Flow

The reference Bruno collection layout for this slice is:

- `01-auth/session-exchange`
- `02-namespace/start-session`
- `02-namespace/complete-session`
- `02-namespace/get-accepted-verification`
- `03-communities/create-foundational-community`
- `03-communities/get-community`
- `03-communities/get-job`
- `03-communities/get-registry-publication-job`
- `04-posts/create-post`
- `04-posts/get-post`

Suggested environment values:

- `base_url`
- `pirate_access_token`
- `jwt_issuer`
- `jwt_subject`
- `namespace_verification_session_id`
- `namespace_verification_id`
- `community_id`
- `community_provisioning_job_id`
- `community_registry_publication_job_id`
- `post_idempotency_key`
- `post_id`

## Exit Criteria

This slice is complete only when all of the following are true:

- the modular OpenAPI source and bundled artifact are in sync
- the Worker can execute this slice end to end through the `jwt_based_auth` path
- Bruno can run the happy path without a browser
- Bruno can exercise at least one failure case for each step
- community create works with both a synchronous local stub and the pollable async shape
- community create writes a public create-attempt audit row before any operational community row
- the create path exposes registry publication state and pollable registry-publication jobs
- public discovery semantics do not treat unpublished communities as canonical
- post create retry behavior is deterministic through `idempotency_key`

## Out Of Scope

These items are intentionally not frozen by this document:

- broader UI behavior
- MCP generation
- SDK generation
- MPP expansion beyond explicit machine-access surfaces
- broader terminology migration from `club` to `community`
