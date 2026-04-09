# Infisical Migration

Phase the `pirate-v2` Infisical migration deliberately. Do not copy the old `pirate/` secret surface forward wholesale.

## Phase 1

Create a fresh `pirate-v2` Infisical project and populate only:

- `dev:/contracts/story`
  - `STORY_CONTRACT_OWNER_PRIVATE_KEY`

This is the only secret required to run the current Story delivery deploy script at [deploy.sh](/home/t42/Documents/pirate-v2/pirate-contracts/story/delivery/scripts/deploy.sh).

Non-secret deploy inputs stay outside Infisical:

- `RPC_URL`
- `PUBLISH_OPERATOR`
- `SETTLEMENT_OPERATOR`
- `ACCESS_PROOF_SIGNER`
- `OWNER_ADDRESS`

These resolve from repo config and operator-supplied env, not from Infisical.

### Bootstrap Commands

After `infisical login` and project selection, you can create the minimal Phase 1/2 tree with:

```bash
export STORY_CONTRACT_OWNER_PRIVATE_KEY=...
rtk ./scripts/bootstrap-infisical-story.sh
```

If you also want the Phase 2 runtime keys in place immediately:

```bash
export LIT_CHIPOTLE_OPERATOR_API_KEY=...
export LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY=...
export LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY=...
rtk ./scripts/bootstrap-infisical-story.sh
```

The helper creates only:

- `dev:/contracts/story`
- `dev:/services/api` when one or more runtime usage keys are provided

## Phase 2

Populate the runtime Lit usage-key path when API-side publish and access flows are ready:

- `dev:/services/api`
  - `LIT_CHIPOTLE_OPERATOR_API_KEY`
  - `LIT_CHIPOTLE_ACCESS_CONTROLLER_API_KEY`
  - `LIT_CHIPOTLE_STORY_SETTLEMENT_API_KEY`

Add the remaining Story usage keys only when the corresponding families are in active use.

## Explicitly Deferred

Do not pre-populate these paths during the initial Story delivery migration:

- `dev:/contracts/base`

Base deployment is out of scope for the current contract surface. Avoid copying Base secrets from `pirate/` out of habit.

## Turso Control Plane

Pirate's Turso architecture uses:

- one central control-plane database
- one Turso group per community
- one primary community database per group in v0

That secret surface should be introduced deliberately.

### Runtime path

Populate `dev:/services/api` only with:

- `TURSO_CONTROL_PLANE_AUTH_TOKEN`
- `TURSO_COMMUNITY_DB_WRAP_KEY`

Do not store one Turso auth token per community in Infisical.

Per-community database tokens are high-cardinality generated credentials. They should be encrypted with `TURSO_COMMUNITY_DB_WRAP_KEY` and stored in the central control-plane database.

### Provisioning path

Populate `dev:/services/control-plane` with:

- `TURSO_PLATFORM_API_TOKEN`

This key is for provisioning:

- create community groups
- create community primary databases
- mint community database tokens
- transfer community groups during sovereignty handoff

It must not be present in the public API worker runtime.

Non-secret Turso config stays outside Infisical:

- `TURSO_ORGANIZATION_SLUG`
- `TURSO_CONTROL_PLANE_DATABASE_URL`
- naming conventions for groups and databases

Bootstrap helper:

```bash
export TURSO_PLATFORM_API_TOKEN=...
export TURSO_CONTROL_PLANE_AUTH_TOKEN=...
export TURSO_COMMUNITY_DB_WRAP_KEY=...
rtk ./scripts/bootstrap-infisical-turso.sh
```

You may omit any variable you do not want to write yet. The helper writes only the Turso env vars that are present.

## Control Plane

`LIT_CHIPOTLE_ACCOUNT_API_KEY` must not be present in worker runtime env.

If control-plane automation later needs it, create a separate path such as:

- `dev:/local/lit`

Do not place that key under `dev:/services/api`, and do not create it until control-plane tooling actually exists.

## Not Carried Forward

Do not migrate these legacy fallback secrets from `pirate/`:

- `MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY`
- `MUSIC_PURCHASE_BASE_TREASURY_PRIVATE_KEY`
- `STORY_OPERATOR_PRIVATE_KEY`
- `STORY_ACCESS_CONTROLLER_PRIVATE_KEY`
- `STORY_FEED_REGISTRAR_PRIVATE_KEY`
- `STORY_SCROBBLE_OPERATOR_PRIVATE_KEY`

The v2 policy is PKP-only for those families.
