# Staging Neon Hotfix Log

Status: applied

Date:

- April 12, 2026

Scope:

- staging control-plane Neon database only
- live remediation during the end-to-end community create rollout

Purpose:

- record the manual staging DB changes that were applied outside the normal deploy loop
- preserve an auditable trail for the schema and data fixes required to get the staging flow green

## Applied Migrations

The following control-plane migrations were applied directly to staging using the migrator role:

- [0019_control_plane_text_timestamps_to_timestamptz.sql](/home/t42/Documents/pirate-v2/db/control-plane/migrations/0019_control_plane_text_timestamps_to_timestamptz.sql)
- [0032_control_plane_verification_session_metadata.sql](/home/t42/Documents/pirate-v2/db/control-plane/migrations/0032_control_plane_verification_session_metadata.sql)
- [0033_control_plane_namespace_verification_spaces.sql](/home/t42/Documents/pirate-v2/db/control-plane/migrations/0033_control_plane_namespace_verification_spaces.sql)

Important:

- the Spaces migration was applied live before the filename cleanup that removed the duplicate `0026` prefix
- the SQL content is the same migration; only the checked-in filename was renumbered to keep fresh-database ordering unambiguous
- the Postgres migration runner now treats the old `0026_...` filename as a legacy alias for `0033_...` so already-patched environments do not try to replay the migration

## Data Normalization

Three legacy rows in `verification_sessions` were normalized in place:

- column: `requested_capabilities_json`
- previous shape: JSON strings containing serialized arrays
- corrected shape: real JSON arrays

This was required because the deployed Worker now reads those rows through the Postgres/Neon `jsonb` path and expects a real array contract.

## Why These Changes Were Safe

- the applied migrations were additive and matched fields the deployed Worker was already reading or writing
- the row normalization corrected malformed data into the intended contract shape without changing semantic meaning
- the changes were limited to staging, not production

## Fields Unblocked By The Hotfix

These interventions unblocked the current staging Worker on:

- `verification_sessions.wallet_attachment_id`
- `verification_sessions.verification_intent`
- `verification_sessions.policy_id`
- Spaces namespace-verification anchor and challenge fields
- `requested_capabilities_json` parsing under the Neon `jsonb` path

## Verification After Apply

After the migrations and row normalization, staging successfully advanced through:

1. auth session exchange
2. verification session create and complete
3. namespace verification session create and complete
4. community create
5. registry publication
6. initial posts read

Related:

- [community-registry-plane.md](/home/t42/Documents/pirate-v2/docs/community/community-registry-plane.md)
