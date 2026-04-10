# API Worker Auth First Slice Template

This directory is a starter handoff for the first executable account-creation slice.

It lives under `references/templates/` on purpose:

- it is not the production runtime
- it is not the canonical home of the future `pirate-social-club/api` repo
- it is a framework-agnostic starter skeleton the runtime repo can copy and adapt

Scope:

- `POST /auth/session/exchange` through `jwt_based_auth`
- `GET /users/me`
- `GET /onboarding/status`
- `POST /communities` with local synchronous provisioning stub under an async wire contract
- `GET /communities/{community_id}`
- `GET /communities/{community_id}/money-policy`
- `PATCH /communities/{community_id}/money-policy`
- `GET /jobs/{job_id}`

Pinned decisions reflected here:

- upstream JWT verification is HMAC-based for the first local slice
- Pirate bearer tokens use `RS256`
- Pirate bearer token expiration is `1 hour`
- JWT-path users create no wallet attachments
- `verification_capabilities_json` uses one canonical all-unverified baseline
- `label_normalized` is bare, `label_display` includes `.pirate`
- `GlobalHandle.label` maps to `label_display`
- community create is `202` with `{ community, job }`
- local stub provisioning returns a succeeded `community_provisioning` job immediately
- create is idempotent on `namespace_verification_id`
- the implementation-bound public-v0 create contract is intentionally narrow: `display_name`, `governance_mode = centralized`, `namespace.namespace_verification_id`, and `handle_policy.policy_template = standard`
- attached community money policy is a separate read/update surface and remains outside public-v0 create
- richer community configuration remains draft-only or deferred until the runtime persists and returns it coherently

What this template does not include:

- framework-specific routing
- Bruno files

What this template now does include:

- real HMAC `jwt_based_auth` verification
- real RS256 Pirate bearer token signing and verification
- exact env surface for those JWT paths, including `PIRATE_APP_JWT_PUBLIC_KEY`
- typed service and route skeletons for community create, community read, and job read
- SQL-backed reference store skeletons for the control-plane auth/community slice, including attached community money policy persistence
- a real Bun SQL executor path suitable for Neon-backed runtime wiring
- a minimal `fetch` runtime composition at `src/runtime.ts` and `src/worker.ts` for local Neon-backed execution
- a Bun integration test for the Reddit onboarding happy path at `src/reddit-onboarding.test.ts`

It is still a reference template, not the production runtime repo.

For the intended no-browser local execution path, see `LOCAL_E2E.md`.

## Reddit Test Env

The Reddit onboarding integration test uses the live control-plane database and seeds deterministic fixture rows before exercising the reference fetch handler.

Required env:

- `CONTROL_PLANE_DATABASE_URL`

Optional but recommended env:

- `CONTROL_PLANE_MIGRATOR_DATABASE_URL`
  If present, the test applies pending control-plane migrations before seeding fixtures.

Auth env behavior:

- `AUTH_UPSTREAM_JWT_ISSUER`, `AUTH_UPSTREAM_JWT_AUDIENCE`, and `AUTH_UPSTREAM_JWT_SHARED_SECRET` are optional for the test runner. When absent, the test uses the documented dev defaults:
  - issuer: `pirate-dev-upstream`
  - audience: `pirate-api`
  - secret: `dev-upstream-secret`
- `PIRATE_APP_JWT_ISSUER`, `PIRATE_APP_JWT_AUDIENCE`, `PIRATE_APP_JWT_PRIVATE_KEY`, and `PIRATE_APP_JWT_PUBLIC_KEY` are also optional for the test runner. When absent, the smoke helper generates an ephemeral RS256 keypair in-process.

Recommended local run:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun test references/templates/api-worker-auth-first-slice/src/reddit-onboarding.test.ts
```

To let the test also apply migrations, expose the migrator URL in the shell first or run under a context that includes `CONTROL_PLANE_MIGRATOR_DATABASE_URL`.
