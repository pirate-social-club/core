# Turso Live Validation Runbook

Use this runbook to validate the checked-in private Turso control-plane path against a real staging environment.

This is an operator flow. Do not use the public `POST /communities` runtime path for this validation because the public runtime is not yet wired to the private Turso provisioning command.

## Goal

Prove all three implemented private control-plane commands against staging:

- `provision-community`
- `doctor`
- `rotate-community-token`

The validation is successful when all three commands complete against a real Turso org and the staging API can still read the provisioned community after rotation.

## Latest Validation Snapshot

Validated on `2026-04-12` against staging:

- existing staging community `cmt_infinity_01`
  - `doctor` returned `findings: 0`
  - public reads succeeded:
    - `GET /communities/infinity`
    - `GET /communities/cmt_infinity_01/posts`
  - `rotate-community-token` succeeded
  - post-rotation `doctor` returned `findings: 0`
  - post-rotation public reads still succeeded
- fresh disposable staging community `cmt_turso_live_01`
  - control-plane fixture seed succeeded
  - `provision-community` succeeded
  - post-provision `doctor` returned `findings: 0`
  - public reads succeeded:
    - `GET /communities/cmt_turso_live_01`
    - `GET /communities/cmt_turso_live_01/posts`

This means the live private Turso control-plane path is now validated for:

- fresh community provisioning
- credential rotation
- encrypted credential decryption in the runtime
- remote community DB schema verification through `doctor`
- public staging API reads after both fresh provision and rotation

## Required Inputs

Operator env file:
- [scripts/infisical/.env.operator-staging.example](../../scripts/infisical/.env.operator-staging.example:1)

API staging env file:
- [pirate-api/services/api/.env.staging.example](../../pirate-api/services/api/.env.staging.example:1)

Required operator env:
- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_ORGANIZATION_SLUG`
- `EXPECTED_TURSO_ORGANIZATION_SLUG`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- `TURSO_COMMUNITY_DB_WRAP_KEY_VERSION`

For staging validation, both Turso organization variables should be `pirate-staging`.

Required staging API env:
- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- `ALLOW_LOCAL_STUB_REGISTRY_PUBLICATION=false`

## Validation Fixture

Use one stable staging fixture so the control-plane rows, Turso resources, and audit history are easy to inspect:

- `community_id = cmt_infinity_01`
- `creator_user_id = usr_infinity_01`
- `namespace_verification_id = nv_infinity_usr_infinity_01`
- `group_name = region-aws-us-east-1`
- `database_name = main-cmt-infinity-01`
- `route ref = infinity`

Set the operator variables once for the whole session:

```bash
cd /home/t42/Documents/pirate-workspace/core

export PIRATE_OPERATOR_ENV_FILE=scripts/.env.operator-staging
export PIRATE_COMMUNITY_ID=cmt_infinity_01
export PIRATE_CREATOR_USER_ID=usr_infinity_01
export PIRATE_NAMESPACE_VERIFICATION_ID=nv_infinity_usr_infinity_01
export PIRATE_DISPLAY_NAME=Infinity
export PIRATE_GROUP_LOCATION=aws-us-east-1
export PIRATE_NAMESPACE_LABEL=infinity
```

## Steps

### 1. Seed or confirm the control-plane actor

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile control-plane-seed -- \
  rtk bun scripts/control-plane/seed-control-plane-fixtures.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id "$PIRATE_CREATOR_USER_ID" \
    --subject infinity-subject-01 \
    --handle infinitytester \
    --namespace-label "$PIRATE_NAMESPACE_LABEL" \
    --reddit-username infinitypilot \
    --issuer pirate-dev-upstream
```

Expected result:
- user exists
- verified attachable namespace verification exists for `infinity`

### 2. Provision the community Turso database

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-provision -- \
  rtk bun scripts/turso/turso-control-plane.ts provision-community \
    --community-id "$PIRATE_COMMUNITY_ID" \
    --creator-user-id "$PIRATE_CREATOR_USER_ID" \
    --display-name "$PIRATE_DISPLAY_NAME" \
    --namespace-verification-id "$PIRATE_NAMESPACE_VERIFICATION_ID" \
    --group-location "$PIRATE_GROUP_LOCATION" \
    --posting-unique-human-provider very \
    --namespace-label "$PIRATE_NAMESPACE_LABEL"
```

Expected result:
- Turso group exists: `region-aws-us-east-1`
- Turso DB exists: `main-cmt-infinity-01`
- one active primary binding row exists
- one active encrypted credential row exists
- provisioning job succeeds
- community ends with `provisioning_state = active`

### 3. Run doctor immediately after provisioning

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-doctor -- \
  rtk bun scripts/turso/turso-control-plane.ts doctor \
    --community-id "$PIRATE_COMMUNITY_ID"
```

Expected result:
- exit code `0`
- `findings: 0`

This proves:
- active community and binding pointers are consistent
- naming matches the current convention
- the active encrypted credential can be decrypted with the configured wrap key
- the remote DB `schema_migrations` table matches the expected community-template migrations

### 4. Start or restart the staging API with the current staging env

The API must have:
- `CONTROL_PLANE_DATABASE_URL`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- no `TURSO_PLATFORM_API_TOKEN`

### 5. Verify staging reads through the remote Turso binding

Use [Infinity Staging Validation](../runbooks/infinity-staging-validation.md:1).

Minimum acceptance:
- `GET /communities/infinity` succeeds
- `GET /communities/cmt_infinity_01/posts` succeeds
- `/c/infinity` renders on staging web

### 6. Rotate the community DB token

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-rotate -- \
  rtk bun scripts/turso/turso-control-plane.ts rotate-community-token \
    --community-id "$PIRATE_COMMUNITY_ID" \
    --reason live_validation
```

Expected result:
- a new `worker-cmt_infinity_01-v<n>` credential becomes active
- the previous active credential becomes `superseded`
- the primary binding remains unchanged

### 7. Re-run doctor after rotation

```bash
rtk ./scripts/infisical/operator-env-run.sh --env-file "$PIRATE_OPERATOR_ENV_FILE" --profile turso-doctor -- \
  rtk bun scripts/turso/turso-control-plane.ts doctor \
    --community-id "$PIRATE_COMMUNITY_ID"
```

Expected result:
- exit code `0`
- `findings: 0`

### 8. Re-run the minimum staging read checks

Confirm the staging API can still decrypt the active credential and read the remote DB after rotation:
- `GET /communities/infinity` succeeds
- `GET /communities/cmt_infinity_01/posts` succeeds

## Failure Triage

### `provision-community` fails

Check:
- `namespace_verifications.status = verified`
- `namespace_verifications.club_attach_allowed = 1`
- the namespace verification belongs to the expected creator user
- `TURSO_PLATFORM_API_TOKEN` and `TURSO_ORGANIZATION_SLUG` are correct
- `EXPECTED_TURSO_ORGANIZATION_SLUG` matches `TURSO_ORGANIZATION_SLUG`

### `doctor` reports binding or credential findings

Check:
- `communities.primary_database_binding_id`
- active `community_database_bindings` row for `binding_role = 'primary'`
- active `community_db_credentials` row count
- `TURSO_COMMUNITY_DB_WRAP_KEY` matches the one used during provisioning

### `doctor` reports schema migration drift

Check:
- the remote DB is the expected community DB
- `schema_migrations` exists in the remote DB
- the remote DB was bootstrapped through the checked-in community bootstrap path
- no undocumented schema or data hotfixes exist outside the checked-in migration/history record
- any live staging DB intervention is recorded in [staging-neon-hotfix-log.md](./staging-neon-hotfix-log.md)

### staging API reads fail after successful operator commands

Check:
- staging API env includes `CONTROL_PLANE_DATABASE_URL`
- staging API env includes `TURSO_COMMUNITY_DB_WRAP_KEY`
- the API is not still pointed at a local file-backed community DB root for this community

## Definition Of Done

Live Turso validation is complete when:

- `provision-community` succeeds on staging
- `doctor` succeeds immediately after provisioning
- staging API reads the provisioned community from the remote DB
- `rotate-community-token` succeeds
- `doctor` succeeds again after rotation
- staging API still reads the provisioned community after rotation
