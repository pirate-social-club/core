# Database Migrations

Pirate v2 now has two relational migration roots:

- `db/control-plane/migrations/`
  Central Pirate-owned control-plane schema for identity, auth links, verification, community routing, encrypted community credentials, global scrobble and track anchor state, projections, jobs, and audit.
- `db/community-template/migrations/`
  Baseline per-community schema applied to each new community `main` database at provisioning time.

Runtime note:

- `db/` is the canonical migration source for operational docs and bootstrap commands.
- `pirate-api/db/` contains worker-local fixture migrations where the API slice needs them.
- Keep the community-template trees in sync; control-plane fixture files may diverge when the worker fixture target is SQLite/libSQL while canonical control-plane migrations are PostgreSQL-first.

Related docs:

- [turso-control-plane-schema.md](/home/t42/Documents/pirate-v2/docs/turso-control-plane-schema.md)
- [turso-provisioning-contract.md](/home/t42/Documents/pirate-v2/docs/turso-provisioning-contract.md)
- [turso-data-boundaries.md](/home/t42/Documents/pirate-v2/docs/turso-data-boundaries.md)

## Current Scope

These migrations are the first executable baseline, not the final full product schema.

Current posture:

- control-plane migrations are intended to be real and durable
- community-template migrations intentionally cover only the stable v0 sovereignty core
- richer commerce, analytics, and read-model denormalizations can be added later in new migrations

## Ordering

Control-plane migrations:

- `0001_control_plane_identity.sql`
- `0002_control_plane_communities.sql`
- `0003_control_plane_scrobbles.sql`
- `0004_control_plane_jobs_and_audit.sql`
- `0005_control_plane_namespace_verification.sql`
- `0006_control_plane_community_create_idempotency.sql`
- `0007_control_plane_registry_publication.sql`
- `0008_control_plane_reddit_onboarding_and_profiles.sql`
- `0009_control_plane_market_context_bindings.sql`
- `0010_control_plane_community_money_policies.sql`
- `0011_control_plane_song_artifact_bundles.sql`
- `0012_control_plane_song_artifact_uploads.sql`
- `0013_control_plane_song_artifact_upload_storage_metadata.sql`
- `0014_control_plane_community_discovery_projection.sql`
- `0015_control_plane_song_artifact_bundle_enrichment.sql`
- `0016_control_plane_community_pricing_policies.sql`
- `0017_control_plane_json_text_to_jsonb.sql`
- `0018_control_plane_device_sessions.sql`
- `0019_control_plane_text_timestamps_to_timestamptz.sql`

Community-template migrations:

- `1001_community_core.sql`
- `1002_community_listings.sql`
- `1003_community_post_idempotency.sql`
- `1004_community_market_context.sql`
- `1005_community_purchase_quotes.sql`
- `1006_community_assets.sql`
- `1007_community_cached_counts.sql`
- `1008_community_gate_rules.sql`
- `1009_community_purchase_quote_verification_snapshots.sql`

## Local Apply

Until a runtime repo grows its own migration command, this repo provides:

- a local SQLite/libSQL migration runner for community workflows
- a Postgres migration runner for the Neon-backed control plane

Postgres / Neon:

```bash
rtk infisical run --env dev --path /services/control-plane -- \
  bun scripts/apply-postgres-migrations.ts \
    --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
    --migrations db/control-plane/migrations \
    --label control-plane
```

SQLite/libSQL community template:

```bash
rtk bash scripts/apply-sqlite-migrations.sh \
  --db /tmp/pirate-community-template.db \
  --migrations db/community-template/migrations \
  --label community-template
```

The runner:

- applies `.sql` files in lexicographic order
- records successful applications in `schema_migrations`
- skips already-applied migrations when the checksum matches
- fails if a previously applied migration file has changed

## Local Fixtures

Control-plane fixture seed for the JWT-first, no-browser path:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/seed-control-plane-fixtures.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --user-id usr_demo_01 \
    --subject demo-subject-01 \
    --handle demo \
    --namespace-label demo
```

Local community bootstrap using the seeded namespace verification:

```bash
rtk infisical run --env dev --path /services/api -- \
  bun scripts/bootstrap-community-slice.ts \
    --database-url-env CONTROL_PLANE_DATABASE_URL \
    --community-db /tmp/pirate-community-demo.db \
    --community-id cmt_demo_01 \
    --user-id usr_demo_01 \
    --display-name "Demo Community" \
    --namespace-verification-id nv_demo_usr_demo_01 \
    --namespace-label demo
```

## Notes

- The community migration files target SQLite-compatible Turso/libSQL DDL.
- The control-plane migration files are PostgreSQL-first and apply directly to Neon from `db/control-plane/migrations/`.
- Community databases intentionally do not define a `users` table. They reference central Pirate `user_id` values as foreign identifiers, not local user rows.
- This repo now includes migration runners in [scripts/apply-sqlite-migrations.sh](/home/t42/Documents/pirate-v2/scripts/apply-sqlite-migrations.sh) and [scripts/apply-postgres-migrations.ts](/home/t42/Documents/pirate-v2/scripts/apply-postgres-migrations.ts), plus [scripts/seed-control-plane-fixtures.ts](/home/t42/Documents/pirate-v2/scripts/seed-control-plane-fixtures.ts) and [scripts/bootstrap-community-slice.ts](/home/t42/Documents/pirate-v2/scripts/bootstrap-community-slice.ts) for Neon-backed local slice bootstrapping.
