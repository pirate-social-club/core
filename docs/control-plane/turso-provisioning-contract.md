# Turso Provisioning Contract

Defines the control-plane contract for creating, rotating, and transferring community Turso groups and databases.

Related:

- [turso-sovereignty-adr.md](../turso-sovereignty-adr.md)
- [control-plane-schema.md](./control-plane-schema.md)
- [turso-secret-contract.md](./turso-secret-contract.md)
- [turso-data-boundaries.md](./turso-data-boundaries.md)

## Scope

This document is the interface contract, not the final implementation language.

The first implementation may be:

- a human-run CLI
- a private control-plane Worker
- a private control-plane script invoked from CI or an operator machine

The contract must stay stable even if the implementation medium changes.

## Actors

- public API worker
  Reads central routing metadata and decrypts community DB credentials at runtime. It must not hold `TURSO_PLATFORM_API_TOKEN`.
- private control-plane automation
  Holds `TURSO_PLATFORM_API_TOKEN` and talks to the Turso Platform API.
- human operator
  Approves exceptional operations such as transfer, backfill, or emergency credential rotation.

## Naming Rules

Stable naming is mandatory.
Normalize `community_id` for Turso resource names by lowercasing and converting underscores to dashes.

- Turso organization slug: the environment boundary
- community Turso group name: `club-<normalized community_id>`
- primary database name: `main-<normalized community_id>`
- primary database binding role: `primary`
- database token name: `worker-<community_id>-v<rotation_number>`

Expected organization slugs:

| Environment | Turso organization slug |
| --- | --- |
| Dev | `pirate-dev` |
| Staging | `pirate-staging` |
| Production | `pirate-prod` |

Day-to-day resource identity should read as:

```text
<environment org> / club-<community_id> / main-<community_id>
```

For example, `pirate-prod / club-cmt-alpha / main-cmt-alpha` is production. A group named
`club-cmt-alpha` in `pirate-staging` is staging. Environment prefixes should not be added to
group or database names because the group is the future community transfer/sovereignty unit.

Do not derive group or database names from:

- display name
- mutable route slug
- namespace label

## Required Inputs

The provisioning layer should require only stable inputs:

- `community_id`
- `creator_user_id`
- `display_name`
- `namespace_verification_id`
- `group_location`

Optional inputs:

- initial route slug
- initial club bootstrap payload to seed into the community DB

## Community Lifecycle States

Central `communities.provisioning_state` should use:

- `requested`
- `provisioning`
- `active`
- `rotation_required`
- `error`

Central `communities.transfer_state` should use:

- `none`
- `pending`
- `transferred`
- `federated`

## Provision Community

Purpose:

- create the Turso sovereignty unit for a new club

Input:

- `community_id`
- `creator_user_id`
- `display_name`
- `namespace_verification_id`
- `group_location`
- `bootstrap_payload`

Bootstrap payload should include the durable rows that must exist in the community DB from day one, such as:

- initial community settings
- namespace binding snapshot
- initial handle policy
- creator membership
- initial moderator role
- optional bootstrap label/community profile blocks

Steps:

1. Create or confirm a central `communities` row with `provisioning_state = requested`.
2. Transition the row to `provisioning`.
3. Create Turso group `club-<normalized community_id>`.
4. Create primary database `main-<normalized community_id>` in that group.
5. Mint a database-scoped runtime token for that database.
6. Encrypt that token with `TURSO_COMMUNITY_DB_WRAP_KEY`.
7. Write `community_database_bindings` and `community_db_credentials`.
8. Connect to the new community DB and apply bootstrap schema or migrations.
9. Seed the bootstrap payload into the community DB.
10. Mark the central `communities` row as `active`.
11. Emit projection work for any required global read models.
12. Append an `audit_log` event.

Output:

- `community_id`
- `group_name`
- `database_name`
- `database_url`
- `community_database_binding_id`
- `community_db_credential_id`
- final `provisioning_state`

Failure rules:

- if Turso resources were created but bootstrap seeding failed, the central row must remain non-active
- failures must leave enough metadata to reconcile or clean up safely
- no public route should assume the community is usable until `provisioning_state = active`

## Rotate Community DB Token

Purpose:

- replace the active runtime DB token for one community

Input:

- `community_id`
- optional `reason`

Steps:

1. Resolve the active `community_database_binding`.
2. Mint a new database-scoped token named `worker-<community_id>-v<next>`.
3. Encrypt the token with the current wrap key.
4. Insert a new `community_db_credentials` row as active.
5. Mark the previous credential row superseded.
6. Invalidate old DB tokens once cutover is confirmed.
7. Append an audit event.

Output:

- `community_id`
- `community_db_credential_id`
- `token_name`
- `rotation_number`

Rules:

- only one active credential row per binding
- token rotation must not require changing the database URL

## Rewrap Community Credentials

Purpose:

- rotate `TURSO_COMMUNITY_DB_WRAP_KEY` without changing Turso-issued tokens

Input:

- `from_key_version`
- `to_key_version`

Steps:

1. Load all active and retained encrypted community credential rows.
2. Decrypt with the old wrap key.
3. Re-encrypt with the new wrap key.
4. Update `encryption_key_version`.
5. Record a batch audit event.

Rules:

- this is a data migration
- do not mix token rotation and wrap-key rotation in the same step unless necessary for incident response

## Transfer Community Group

Purpose:

- hand a community's Turso sovereignty unit to another organization

Input:

- `community_id`
- `target_organization_slug`
- `post_transfer_mode`

`post_transfer_mode` should be one of:

- `archival`
- `federated`
- `full_exit`

Steps:

1. Set `transfer_state = pending`.
2. Freeze structural mutations for that community.
3. Drain or pause projection jobs for that community.
4. Confirm the receiving organization and operator contacts.
5. Transfer the Turso group.
6. Mint fresh credentials under the receiving organization.
7. Update `community_database_bindings` and `community_db_credentials`.
8. Resume according to `post_transfer_mode`.
9. Mark `transfer_state` appropriately and append audit events.

Output:

- `community_id`
- prior `organization_slug`
- new `organization_slug`
- new credential record IDs
- final `transfer_state`

Rules:

- transfer is a control-plane operation, never an inline public API request
- Pirate must not treat old URLs or tokens continuing to work as a steady-state contract

## Deactivate Community

Purpose:

- stop routing a community database without deleting history

Input:

- `community_id`
- `reason`

Steps:

1. Mark binding status inactive.
2. Mark community status suspended or archived.
3. Stop issuing new runtime reads or writes.
4. Preserve routing and audit history.

## Runtime Read Contract

The public API worker needs only this resolved runtime view:

- `community_id`
- active `database_url`
- decrypted active DB token
- credential key version
- routing status

The API worker must not:

- create groups
- create databases
- mint tokens
- transfer groups

Those are private control-plane responsibilities.

## Reconciliation Tasks

The control plane should support eventual doctor or reconcile actions:

- verify every `active` community has one active binding
- verify every active binding has one active encrypted credential
- verify central registry group and database names match the naming convention
- verify `database_url` resolves to the expected group and database
- verify the community DB bootstrap schema version matches expected migrations

## Current CLI Shape

The first human-run interface now exists for provisioning:

```bash
rtk bun scripts/turso/turso-control-plane.ts provision-community --community-id cmt_01... --creator-user-id usr_01... --display-name "Infinity" --namespace-verification-id nv_01... --group-location aws-us-east-1
```

Implemented in the current CLI:

- `provision-community`
- `rotate-community-token`
- `doctor` for binding, credential, naming, URL, and schema-migration drift checks

Still planned:

- `transfer-community`

The exact runtime can change later. The durable side effects should not.
