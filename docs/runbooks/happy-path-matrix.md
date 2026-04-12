# Happy Path Matrix

Status as of 2026-04-12.

## Target

The near-term shipping goal is:

- one operational `Infinity` community on staging
- real web app
- real API
- Neon control plane
- Turso community database
- Very-backed first text post gate working end to end

This goal does not require Tableland publication yet.

## Architecture

- control plane: Neon/Postgres
- community databases: Turso/libSQL
- local development: file-backed emulation for both planes
- registry/publication: later phase for the happy path

## Current State

| Happy path | Status | Notes |
|---|---|---|
| Local operational Infinity | Green | Proven locally end to end, including the Very first-text-post rule |
| Staging operational Infinity | Next | Correct next goal; requires manual Turso bring-up or a small operator script |
| Staging published Infinity | Not started | Defer until staging operational Infinity is stable |
| Generic self-serve community creation | Not started | Defer until the single-community staging path is stable |

## What Is Already Working

- Infinity local fixture bootstrap
- backend posting gate enforcement with `first_post_only`
- `pirate-web` gate handling from API `gate_rules`
- route write path using real `community_id`
- browser text post creation in local Infinity
- Neon-shaped control-plane runtime contract in the API
- runtime read path for remote Turso community databases through `community_database_bindings` and `community_db_credentials`
- Turso Platform client primitives in [scripts/lib/turso-platform.ts](../../scripts/lib/turso-platform.ts)
- checked-in operator provisioning command in [scripts/turso-control-plane.ts](../../scripts/turso-control-plane.ts)

## What Is Not Wired Yet

- public self-serve `POST /communities` still depends on a private provision operator in non-local environments
- the private operator service itself still needs deployment and runtime ownership outside local test doubles
- no staging runbook previously existed before this slice

## Recommended Execution Order

1. Bring up Infinity on staging with the operator command.
2. Validate `/c/infinity` and first text post on staging.
3. If needed, keep a fully manual fallback for reconciliation and emergency recovery.
4. Switch any operator hand-steps around that command into one repeatable staging workflow.
5. Only then take on registry publication and generic community creation.

## Acceptance Criteria

### Local operational Infinity

- `GET /communities/infinity` works
- `/c/infinity` loads in `pirate-web`
- `/c/infinity/submit` enforces or clears the Very gate correctly
- a text post can be created successfully

### Staging operational Infinity

- staging API uses Neon control plane
- Infinity has a real Turso database binding
- API can read and write the remote community DB
- `/c/infinity` loads on staging web
- first Infinity text post works through Very

### Staging published Infinity

- staging operational Infinity is already stable
- registry publisher path succeeds
- publication state is visible and auditable

### Self-serve community creation

- operator-managed staging path is already stable
- remote Turso provisioning is already available as an operator command
- failure and retry behavior is documented
