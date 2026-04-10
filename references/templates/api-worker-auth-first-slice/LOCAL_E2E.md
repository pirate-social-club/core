# Local Account E2E

This walkthrough is the local execution target for the account slice.

It is intentionally narrow:

1. apply control-plane migrations
2. seed one deterministic control-plane user
3. mint one valid upstream JWT for that seeded subject
4. call `POST /auth/session/exchange`
5. call `GET /users/me`
6. call `GET /onboarding/status`
7. call `POST /onboarding/reddit-verification`
8. call `POST /onboarding/reddit-imports`
9. run one `reddit_snapshot_import` platform job
10. run one `reddit_feature_derivation` platform job
11. call `GET /onboarding/reddit-imports/latest`
12. call `POST /communities`
13. run one `community_provisioning` job
14. run one `community_registry_publication` job
15. call `GET /communities/{community_id}`
16. call `GET /communities/{community_id}/money-policy`
17. call `GET /jobs/{job_id}`

It does not make this directory a production runtime. It defines the exact behavior the future `pirate-social-club/api` repo should reproduce.

For a single-command in-process check of the Reddit onboarding happy path after migrations and fixture seed, run:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/reddit-onboarding-smoke.ts
```

For the Bun integration test variant, run:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun test references/templates/api-worker-auth-first-slice/src/reddit-onboarding.test.ts
```

## Scope

This walkthrough proves the account-first plus local control-plane community-create path:

- upstream proof type is `jwt_based_auth`
- upstream JWT verification is HS256 shared-secret based
- Pirate bearer tokens are signed and verified with `RS256`
- the seeded user resumes through `auth_provider_links`
- authenticated reads work with the returned Pirate bearer token
- the seeded Reddit verification and onboarding snapshot round-trip through the three Reddit onboarding endpoints
- community create writes the control-plane community and a queued provisioning job synchronously under the async API contract
- local job execution provisions the community DB and then publishes the canonical registry rows through the internal Tableland publisher

It does not cover:

- real wallet attachment flows
- real human-verification providers
- real HNS verification
- remote Turso provisioning
- production signer management beyond the local direct-key publisher

## Local Inputs

Use these local values consistently:

```text
CONTROL_PLANE_DATABASE_URL=<load from Infisical dev:/services/api>
CONTROL_PLANE_MIGRATOR_DATABASE_URL=<load from Infisical dev:/services/control-plane>
API_BASE_URL=http://127.0.0.1:8787
AUTH_UPSTREAM_JWT_ISSUER=pirate-dev-upstream
AUTH_UPSTREAM_JWT_AUDIENCE=pirate-api
AUTH_UPSTREAM_JWT_SHARED_SECRET=dev-upstream-secret
FIXTURE_USER_ID=usr_demo_01
FIXTURE_SUBJECT=demo-subject-01
FIXTURE_HANDLE=demo
REGISTRY_PUBLISHER_BASE_URL=http://127.0.0.1:8790
REGISTRY_PUBLISHER_AUTH_TOKEN=local-dev-publisher
LOCAL_COMMUNITY_DB_ROOT=/tmp/pirate-community-dbs
```

## Runtime Env Contract

The future runtime repo should expose exactly this env surface for the slice:

```text
CONTROL_PLANE_DATABASE_URL
AUTH_UPSTREAM_JWT_ISSUER
AUTH_UPSTREAM_JWT_AUDIENCE
AUTH_UPSTREAM_JWT_SHARED_SECRET
PIRATE_APP_JWT_ISSUER
PIRATE_APP_JWT_AUDIENCE
PIRATE_APP_JWT_PRIVATE_KEY
PIRATE_APP_JWT_PUBLIC_KEY
REGISTRY_PUBLISHER_BASE_URL
REGISTRY_PUBLISHER_AUTH_TOKEN
LOCAL_COMMUNITY_DB_ROOT
```

For the first local proof, these values must line up with the seeded fixture and minted JWT:

- `AUTH_UPSTREAM_JWT_ISSUER=pirate-dev-upstream`
- `AUTH_UPSTREAM_JWT_AUDIENCE=pirate-api`
- `AUTH_UPSTREAM_JWT_SHARED_SECRET=dev-upstream-secret`

## Step 1. Apply Control-Plane Migrations

```bash
rtk infisical run --env dev --path /services/control-plane -- \
  bun scripts/apply-postgres-migrations.ts \
    --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
    --migrations db/control-plane/migrations \
    --label control-plane
```

Expected result:

- the run completes without error
- all control-plane migrations are applied on a fresh DB
- a rerun skips all previously applied migrations

## Step 2. Seed the Fixture User

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/seed-control-plane-fixtures.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id usr_demo_01 \
    --issuer pirate-dev-upstream \
    --subject demo-subject-01 \
    --handle demo \
    --namespace-label demo
```

The seeded auth link must match the runtime resume key exactly:

- `provider = jwt`
- `provider_subject = pirate-dev-upstream|demo-subject-01`
- `provider_user_ref = demo-subject-01`

That is the shape `POST /auth/session/exchange` resolves against in the template auth bootstrap service.

## Step 3. Mint an Upstream JWT

```bash
rtk bun scripts/mint-test-jwt.mjs \
  --issuer pirate-dev-upstream \
  --audience pirate-api \
  --subject demo-subject-01 \
  --secret dev-upstream-secret
```

Store the output as `UPSTREAM_JWT` in your shell or Bruno environment.

## Step 4. Exchange the Session

Assume the future runtime is serving locally at `http://127.0.0.1:8787`.

Request:

```bash
rtk curl -sS \
  -X POST http://127.0.0.1:8787/auth/session/exchange \
  -H 'content-type: application/json' \
  -d '{
    "proof": {
      "type": "jwt_based_auth",
      "jwt": "'"$UPSTREAM_JWT"'"
    }
  }'
```

Expected status:

- HTTP `200`

Expected body shape:

```json
{
  "access_token": "<pirate bearer token>",
  "user": {
    "user_id": "usr_demo_01"
  },
  "profile": {
    "user_id": "usr_demo_01",
    "display_name": null,
    "global_handle": {
      "label": "demo.pirate"
    }
  },
  "onboarding": {
    "generated_handle_assigned": true,
    "cleanup_rename_available": true,
    "unique_human_verification_status": "verified",
    "namespace_verification_status": "verified",
    "community_creation_ready": true,
    "missing_requirements": [],
    "reddit_verification_status": "verified",
    "reddit_import_status": "succeeded",
    "suggested_community_ids": ["cmt_music_01", "cmt_design_01"]
  },
  "wallet_attachments": []
}
```

Important assertions:

- `access_token` is present
- `user.user_id = usr_demo_01`
- `profile.user_id = usr_demo_01`
- `wallet_attachments` is an empty array on the JWT path
- the seeded user is resumed, not duplicated

Copy the returned `access_token` into `PIRATE_ACCESS_TOKEN` for the authenticated reads.

## Step 5. Call `GET /users/me`

```bash
rtk curl -sS \
  http://127.0.0.1:8787/users/me \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body assertions:

- `user_id = usr_demo_01`
- `verification_state = verified`
- `capability_provider = self`
- `verification_capabilities.unique_human.state = verified`

## Step 6. Call `GET /onboarding/status`

```bash
rtk curl -sS \
  http://127.0.0.1:8787/onboarding/status \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body:

```json
{
  "generated_handle_assigned": true,
  "cleanup_rename_available": true,
  "unique_human_verification_status": "verified",
  "namespace_verification_status": "verified",
  "community_creation_ready": true,
  "missing_requirements": [],
  "reddit_verification_status": "verified",
  "reddit_import_status": "succeeded",
  "suggested_community_ids": ["cmt_music_01", "cmt_design_01"]
}
```

## Step 7. Call `POST /onboarding/reddit-verification`

```bash
rtk curl -sS \
  -X POST http://127.0.0.1:8787/onboarding/reddit-verification \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "reddit_username": "technohippie"
  }'
```

Expected status:

- HTTP `200`

Expected body assertions:

- `reddit_username = technohippie`
- `status = verified`

## Step 8. Call `POST /onboarding/reddit-imports`

```bash
rtk curl -sS \
  -X POST http://127.0.0.1:8787/onboarding/reddit-imports \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "reddit_username": "technohippie"
  }'
```

Expected status:

- HTTP `202`

Expected body assertions:

- `job.job_type = reddit_snapshot_import`
- `job.status = queued` or `job.status = succeeded`

## Step 9. Run One `reddit_snapshot_import` Platform Job

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/run-platform-jobs.ts \
    --job-type reddit_snapshot_import \
    --once
```

Expected result:

- queued Reddit import work is drained once
- a completed import leaves the job in `succeeded`
- a previously completed seeded import may result in no-op worker work

## Step 10. Run One `reddit_feature_derivation` Platform Job

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/run-platform-jobs.ts \
    --job-type reddit_feature_derivation \
    --once
```

Expected result:

- queued deterministic Reddit feature work is drained once
- subreddit affinities, interest tags, and audience segments are written in Neon

## Step 11. Call `GET /onboarding/reddit-imports/latest`

```bash
rtk curl -sS \
  http://127.0.0.1:8787/onboarding/reddit-imports/latest \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body assertions:

- `reddit_username = technohippie`
- `global_karma = 44200`
- `top_subreddits[0].subreddit = electronicmusic`
- `suggested_communities[0].community_id = cmt_music_01`

## Step 12. Call `POST /communities`

```bash
rtk curl -sS \
  -X POST http://127.0.0.1:8787/communities \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "display_name": "Demo Community",
    "membership_mode": "open",
    "governance_mode": "centralized",
    "default_age_gate_policy": "none",
    "namespace": {
      "namespace_verification_id": "nv_demo_usr_demo_01"
    },
    "handle_policy": {
      "policy_template": "standard"
    }
  }'
```

Expected status:

- HTTP `202`

Expected body assertions:

- `community.community_id` is present
- `community.namespace_verification_id = nv_demo_usr_demo_01`
- `community.registry_publication_state = pending_create`
- `job.job_type = community_provisioning`
- `job.status = queued`

Copy `community.community_id` into `COMMUNITY_ID` and `job.job_id` into `JOB_ID`.

## Step 13. Run One `community_provisioning` Job

```bash
rtk env \
  REGISTRY_PUBLISHER_BASE_URL="$REGISTRY_PUBLISHER_BASE_URL" \
  REGISTRY_PUBLISHER_AUTH_TOKEN="$REGISTRY_PUBLISHER_AUTH_TOKEN" \
  LOCAL_COMMUNITY_DB_ROOT="$LOCAL_COMMUNITY_DB_ROOT" \
  rtk infisical run --env dev --path /services/api -- \
    bun scripts/run-community-jobs.ts --job-type community_provisioning --once
```

Expected result:

- the queued provisioning job is claimed and completed
- a `community_registry_publication` job is created
- the community transitions to `provisioning_state = active`
- the community transitions to `registry_publication_state = pending_seed`

## Step 14. Run One `community_registry_publication` Job

```bash
rtk env \
  REGISTRY_PUBLISHER_BASE_URL="$REGISTRY_PUBLISHER_BASE_URL" \
  REGISTRY_PUBLISHER_AUTH_TOKEN="$REGISTRY_PUBLISHER_AUTH_TOKEN" \
  LOCAL_COMMUNITY_DB_ROOT="$LOCAL_COMMUNITY_DB_ROOT" \
  rtk infisical run --env dev --path /services/api -- \
    bun scripts/run-community-jobs.ts --job-type community_registry_publication --once
```

Expected result:

- the queued registry publication job is claimed and completed
- canonical Tableland rows are published for the community
- the community transitions to `registry_publication_state = published`

## Step 15. Call `GET /communities/{community_id}`

```bash
rtk curl -sS \
  "http://127.0.0.1:8787/communities/$COMMUNITY_ID" \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body assertions:

- `community_id = $COMMUNITY_ID`
- `namespace_verification_id = nv_demo_usr_demo_01`
- `registry_publication_state = published`
- `status = active`
- `provisioning_state = active`

Important interpretation:

- the community is operationally usable for post writes and reads
- the canonical public registry publish completed asynchronously after create
- `registry_publication_state = published` means it can be treated as canonical public discovery state

## Step 16. Call `GET /communities/{community_id}/money-policy`

```bash
rtk curl -sS \
  "http://127.0.0.1:8787/communities/$COMMUNITY_ID/money-policy" \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body assertions:

- `community_id = $COMMUNITY_ID`
- `policy_origin = default`
- `route_required = false`

## Step 17. Call `GET /jobs/{job_id}`

```bash
rtk curl -sS \
  "http://127.0.0.1:8787/jobs/$JOB_ID" \
  -H "authorization: Bearer $PIRATE_ACCESS_TOKEN"
```

Expected status:

- HTTP `200`

Expected body assertions:

- `job_id = $JOB_ID`
- `job_type = community_provisioning`
- `status = succeeded`

## SQL Checks

These checks should pass after the fixture seed and still hold after a successful exchange.

### Auth Link Resume Key

```bash
rtk infisical run --env dev --path /services/api -- \
  bun -e 'const db = new Bun.SQL(process.env.CONTROL_PLANE_DATABASE_URL); const rows = await db`SELECT provider, provider_subject, provider_user_ref FROM auth_provider_links`; console.table(rows); await db.end();'
```

Expected row:

```text
jwt | pirate-dev-upstream|demo-subject-01 | demo-subject-01
```

### User Resolution

```bash
rtk infisical run --env dev --path /services/api -- \
  bun -e 'const db = new Bun.SQL(process.env.CONTROL_PLANE_DATABASE_URL); const rows = await db`SELECT user_id, verification_state, capability_provider, current_verification_session_id FROM users`; console.table(rows); await db.end();'
```

Expected row:

- `user_id = usr_demo_01`
- `verification_state = verified`
- `capability_provider = self`
- `current_verification_session_id = ver_usr_demo_01_unique_human`

### Profile and Handle

```bash
rtk infisical run --env dev --path /services/api -- \
  bun -e 'const db = new Bun.SQL(process.env.CONTROL_PLANE_DATABASE_URL); const rows = await db`SELECT p.user_id, g.label_normalized, g.label_display, g.issuance_source FROM profiles p JOIN global_handles g ON g.global_handle_id = p.global_handle_id`; console.table(rows); await db.end();'
```

Expected row:

- `user_id = usr_demo_01`
- `label_normalized = demo`
- `label_display = demo.pirate`
- `issuance_source = generated_signup`

### Accepted `unique_human`

```bash
rtk infisical run --env dev --path /services/api -- \
  bun -e 'const db = new Bun.SQL(process.env.CONTROL_PLANE_DATABASE_URL); const rows = await db`SELECT user_id, capability_key, status FROM user_attestations WHERE capability_key = '"'"'unique_human'"'"'`; console.table(rows); await db.end();'
```

Expected row:

- `user_id = usr_demo_01`
- `capability_key = unique_human`
- `status = accepted`

### Reddit Snapshot

```bash
rtk infisical run --env dev --path /services/api -- \
  bun -e 'const db = new Bun.SQL(process.env.CONTROL_PLANE_DATABASE_URL); const rows = await db`SELECT source_account_handle, captured_at, snapshot_payload_json FROM external_reputation_snapshots`; console.table(rows.map((row) => ({ source_account_handle: row.source_account_handle, captured_at: row.captured_at }))); await db.end();'
```

Expected row:

- `source_account_handle = technohippie`

## Minimum Failure Coverage

These failures should be part of the first Bruno pass:

1. expired upstream JWT -> `401 auth_error`
2. wrong issuer -> `401 auth_error`
3. wrong audience -> `401 auth_error`
4. malformed JWT -> `401 auth_error`
5. `GET /users/me` without bearer token -> `401 auth_error`
6. `GET /onboarding/status` without bearer token -> `401 auth_error`
7. valid bearer token whose `sub` no longer resolves in storage -> stable auth failure, not an unhandled 500

## Fixture Notes

The fixture path intentionally accelerates local proof:

- the seeded user already has accepted `unique_human`
- the seeded user already has a generated handle and profile
- the seeded user already has a verified Reddit username plus one immutable onboarding snapshot
- the seeded user now mirrors first-login bootstrap more closely by storing `label_display = demo.pirate` and leaving `profile.display_name = null`

## Variant: Existing User Posts To Infinity

Use this variant when you want an explicit named scenario instead of the generic demo flow.

Bootstrap command:

```bash
rtk infisical run --env dev --path /services/api -- \
  ./scripts/bootstrap-infinity-existing-user.sh \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --community-db /tmp/pirate-infinity.db
```

Expected result:

- existing user fixture is present in the control-plane DB
- `community_id = cmt_infinity_01`
- local community DB exists at `/tmp/pirate-infinity.db`
- creator membership and owner role are seeded in the community DB
- `provisioning_state = active`
- `registry_publication_state = not_started`

Interpretation:

- this proves an existing user can post into an operational Infinity fixture
- it does not prove Infinity has been published to Tableland
- Tableland publication is a distinct registry-publication flow and must not be inferred from the local stub bootstrap path

## Exit Condition

This walkthrough is satisfied only when the future runtime repo can reproduce the full sequence with:

- real request handling
- real bearer-token verification on authenticated routes
- stable error responses for the listed failure cases
- no duplicate user created during fixture resume
