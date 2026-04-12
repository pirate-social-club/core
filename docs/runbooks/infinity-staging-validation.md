# Infinity Staging Validation

Use this after manual staging bring-up.

The purpose is to prove one operational Infinity community on staging before taking on registry publication or generic community creation.

## Preconditions

- staging API is running against Neon
- Infinity has an active Turso community DB binding
- Infinity remote community DB has been migrated and bootstrapped
- `rtk bun scripts/turso-control-plane.ts doctor --community-id cmt_infinity_01` returns `findings: 0`
- staging web points at the staging API
- Very credentials are configured in staging

## API Checks

### Community resolution

- `GET /communities/infinity` returns the Infinity community
- `GET /communities/cmt_infinity_01/posts` returns the community feed from Turso

### Auth and viewer state

- `POST /auth/session/exchange` succeeds
- `GET /users/me` succeeds

### Gate behavior

Before join:

- a user without a Very-backed `unique_human` proof is blocked from joining
- the API returns `gate_failed` with `verification_policy.policy_id = policy_very_join_v1`
- a user with `provider = very` is allowed to join

## Web Checks

### Community page

- `/c/infinity` loads
- feed renders
- sidebar/header renders

### Join flow

- clicking `Join` on `/c/infinity` routes the user into the Very verification flow when they do not already satisfy the gate
- after successful Very verification, the user returns to `/c/infinity`
- the join retry succeeds and the user becomes a member

## Failure Triage

### `/communities/infinity` fails

Check:

- `communities` row exists in Neon
- `provisioning_state = active`
- route resolution fields match the Infinity namespace state

### feed read fails

Check:

- `community_database_bindings.database_url` points at the real Turso DB
- one active `community_db_credentials` row exists
- encrypted token decrypts with the current `TURSO_COMMUNITY_DB_WRAP_KEY`
- `rtk bun scripts/turso-control-plane.ts doctor --community-id cmt_infinity_01` reports no binding or schema findings

### join still blocks after Very

Check:

- `gate_rules` on the community response
- `/users/me`
- `verification_capabilities.unique_human.provider`
- `verification_capabilities.unique_human.state`

### join retry fails

Check:

- the web is joining with `community_id`, not route ref
- the staging API can read and write the remote Turso DB
- the Infinity membership gate in the community DB still matches the local proven shape

## Exit Criteria

Staging Infinity is operational when all of these are true:

- community read works
- feed read works
- join gating works
- Very verification clears the join gate
- successful join completes after verification
- `doctor` stays clean before and after a token rotation
