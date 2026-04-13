# Infinity Staging Manual Bring-Up

This is the fastest path to a real staging Infinity community.

It remains operator-managed for staging because the runtime `POST /communities` path now expects a private provision operator in non-local environments. The checked-in Turso provisioning command and the private HTTP operator exist, but they are still private operator flows, not open public self-serve community creation.

## Goal

Bring up one operator-managed Infinity community on staging with:

- Neon control plane
- real Turso community DB
- real staging API and web
- Very-backed first text post gate

## Do Not Assume

- do not use `POST /communities` on staging for this path
- do not block this path on Tableland publication
- do not wait for self-serve community creation

## What Already Exists

- Turso Platform client primitives in [scripts/lib/turso-platform.ts](../../scripts/lib/turso-platform.ts)
- operator provisioning command in [scripts/turso-control-plane.ts](../../scripts/turso-control-plane.ts)
- operator provisioning implementation in [scripts/lib/turso-control-plane.ts](../../scripts/lib/turso-control-plane.ts)
- operator HTTP surface in [scripts/turso-control-plane-operator.ts](../../scripts/turso-control-plane-operator.ts)
- operator validation command in [scripts/turso-control-plane.ts](../../scripts/turso-control-plane.ts)
- runtime remote community DB read path in [community-db-factory.ts](../../pirate-api/services/api/src/lib/communities/community-db-factory.ts)
- credential encryption in [community-db-credential-crypto.ts](../../pirate-api/services/api/src/lib/communities/community-db-credential-crypto.ts)
- control-plane tables for `community_database_bindings` and `community_db_credentials`

## Required Inputs

Use stable identifiers:

- `community_id = cmt_infinity_01`
- `route ref = infinity`
- `group name = club-cmt-infinity-01`
- `database name = main-cmt-infinity-01`
- `binding role = primary`

You also need:

- API staging runtime env in [pirate-api/services/api/.env.staging.example](../../pirate-api/services/api/.env.staging.example)
- operator staging env in [scripts/.env.operator-staging.example](../../scripts/.env.operator-staging.example)
- operator env wrapper in [scripts/operator-env-run.sh](../../scripts/operator-env-run.sh)
- a Turso organization slug
- a Turso group location
- working staging web/API env files

Set the shared command variables once:

```bash
cd /home/t42/Documents/pirate-v2

export PIRATE_OPERATOR_ENV_FILE=scripts/.env.operator-staging
export PIRATE_COMMUNITY_ID=cmt_infinity_01
export PIRATE_CREATOR_USER_ID=usr_infinity_01
export PIRATE_NAMESPACE_VERIFICATION_ID=nv_infinity_usr_infinity_01
export PIRATE_DISPLAY_NAME=Infinity
export PIRATE_GROUP_LOCATION=aws-us-east-1
export PIRATE_NAMESPACE_LABEL=infinity
```

## Bring-Up Flow

### 1. Confirm staging control plane and API env

The staging API should already be configured with:

- `CONTROL_PLANE_DATABASE_URL=postgres://...`
- `TURSO_COMMUNITY_DB_WRAP_KEY=...`
- `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION=...`
- `COMMUNITY_PROVISION_OPERATOR_BASE_URL=...`
- `COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN=...`
- `COMMUNITY_PROVISION_DEFAULT_GROUP_LOCATION=...`
- no `LOCAL_COMMUNITY_DB_ROOT`
- no local stub registry flags

If the API needs local files to boot, staging is not ready yet.

Operator commands should source a separate env file instead of the API runtime env.
That operator env should contain:

- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_ORGANIZATION_SLUG`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION`

### 2. Sync staging secrets

Bootstrap the staging Infisical paths from the current local staging env values:

```bash
cd /home/t42/Documents/pirate-v2
set -a
source pirate-api/services/api/.env.staging
source scripts/.env.operator-staging
set +a
INFISICAL_ENV=staging rtk ./scripts/bootstrap-infisical-control-plane.sh
INFISICAL_ENV=staging rtk ./scripts/bootstrap-infisical-turso.sh
INFISICAL_ENV=staging rtk ./scripts/bootstrap-infisical-api-runtime.sh
```

Sync the current API runtime secret surface into the single remote Cloudflare worker:

```bash
cd /home/t42/Documents/pirate-v2
rtk infisical run --env staging --path /services/api -- \
  rtk ./scripts/sync-wrangler-api-secrets.sh
```

### 3. Seed or confirm the Infinity actor and namespace state in Neon

Infinity needs:

- creator user row
- handle/profile state
- verified namespace verification row for `infinity`

Use the existing control-plane fixture tooling where possible. Do not use local community bootstrap scripts for this step.

Recommended command shape:

```bash
rtk ./scripts/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile control-plane-seed -- \
  rtk bun scripts/seed-control-plane-fixtures.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id "$PIRATE_CREATOR_USER_ID" \
    --subject infinity-subject-01 \
    --handle infinitytester \
    --namespace-label "$PIRATE_NAMESPACE_LABEL" \
    --reddit-username infinitypilot \
    --issuer pirate-dev-upstream
```

### 4. Create the Turso sovereignty unit

Preferred path:

```bash
rtk ./scripts/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-provision -- \
  rtk bun scripts/turso-control-plane.ts provision-community \
    --community-id "$PIRATE_COMMUNITY_ID" \
    --creator-user-id "$PIRATE_CREATOR_USER_ID" \
    --display-name "$PIRATE_DISPLAY_NAME" \
    --namespace-verification-id "$PIRATE_NAMESPACE_VERIFICATION_ID" \
    --group-location "$PIRATE_GROUP_LOCATION" \
    --posting-unique-human-provider very \
    --namespace-label "$PIRATE_NAMESPACE_LABEL"
```

Required env for that command:

- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_ORGANIZATION_SLUG`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION`

What it already does:

1. creates or reuses Turso group `club-cmt-infinity-01`
2. creates or reuses database `main-cmt-infinity-01`
3. mints a database token
4. bootstraps the remote community DB
5. inserts or updates `communities`, `community_database_bindings`, and `community_db_credentials`
6. stores an audit event and succeeded provisioning job

Immediately validate the binding:

```bash
rtk ./scripts/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-doctor -- \
  rtk bun scripts/turso-control-plane.ts doctor \
    --community-id "$PIRATE_COMMUNITY_ID"
```

Expected result:
- exit code `0`
- `findings: 0`

Manual fallback:

If the operator command cannot be used, the remaining sections describe the underlying control-plane and Turso state that must exist.

### 5. Understand the credential step

Encrypt the Turso database token with `TURSO_COMMUNITY_DB_WRAP_KEY` using [encryptCommunityDbCredential](../../pirate-api/services/api/src/lib/communities/community-db-credential-crypto.ts).

The output is the `encrypted_token` value stored in the control plane.

### 6. Understand the control-plane routing rows

Write:

- the `communities` row for Infinity
- the primary `community_database_bindings` row with the real `libsql://...` URL
- the active `community_db_credentials` row containing the encrypted token

Important:

- `communities.provisioning_state` must end as `active`
- `community_database_bindings.status` must be `active`
- there must be exactly one active credential row for the primary binding

Use the schema and contract docs for the exact fields:

- [Control Plane Schema](../control-plane-schema.md)
- [Turso Provisioning Contract](../turso-provisioning-contract.md)

### 7. Understand the remote bootstrap payload

Apply the community template migrations to the new Turso database, then seed the durable bootstrap rows:

- community settings/profile
- namespace binding snapshot
- initial handle policy
- creator membership
- creator moderator role
- Infinity posting gate with:
  - scope `posting`
  - gate type `unique_human`
  - accepted provider `very`
  - `post_types = ["text"]`
  - `first_post_only = true`

The community DB bootstrap logic already exists in the local path. Reuse that payload shape; do not invent a second schema.

### 8. Start the staging API and web

Use the staging runtime env files and confirm the API is reading the Neon control plane plus the Turso binding:

- `pirate-api/services/api/.env.staging`
- `pirate-web/.env.staging`

Do not put `TURSO_PLATFORM_API_TOKEN` in the API runtime env.

### 9. Validate the full Infinity path

Use [Infinity Staging Validation](./infinity-staging-validation.md).

### 10. Rotate once before calling the path accepted

This confirms that staging survives a real credential change, not just first-time bring-up.

```bash
rtk ./scripts/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-rotate -- \
  rtk bun scripts/turso-control-plane.ts rotate-community-token \
    --community-id "$PIRATE_COMMUNITY_ID" \
    --reason staging_validation

rtk ./scripts/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-doctor -- \
  rtk bun scripts/turso-control-plane.ts doctor \
    --community-id "$PIRATE_COMMUNITY_ID"
```

After rotation, re-run the minimum staging read checks:

- `GET /communities/infinity`
- `GET /communities/cmt_infinity_01/posts`

## Definition Of Done

The staging bring-up is complete when:

- `/communities/infinity` resolves from staging API
- `/communities/cmt_infinity_01/posts` reads from the remote Turso DB
- `/c/infinity` loads on staging web
- `/c/infinity/submit` respects the first-post gate
- the first Infinity text post succeeds after Very
- `rotate-community-token` succeeds
- `doctor` returns `findings: 0` after rotation

## Next Step After Operator Bring-Up

Once this operator path works on staging:

1. keep the fully manual fallback for reconciliation and emergency repair
2. write the exact staging command and env source into internal operator notes
3. only then consider wiring remote provisioning into broader community-create flows
