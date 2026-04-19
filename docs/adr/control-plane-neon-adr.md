# Neon Control-Plane ADR

Status: accepted

Supersedes the central control-plane storage choice in [turso-sovereignty-adr.md](./turso-sovereignty-adr.md).

## Decision

Pirate v2 will run the central control-plane database on Neon Postgres.

Turso remains the storage boundary for sovereign per-community databases.

This means:

- Neon is the root-of-trust database for platform identity, verification, routing, encrypted community credentials, jobs, and audit state
- Turso remains the community data plane and the transfer unit for future community sovereignty

## Why

The control plane is the highest-value relational database in the system.

It stores:

- platform identity
- auth provider links
- verification and attestation state
- community routing metadata
- encrypted community database credentials
- platform jobs
- platform audit trails

That database needs a stricter security posture than the community databases.

The deciding factors for Neon are:

- real Postgres roles and `GRANT`
- row-level security for sensitive tables
- stronger least-privilege posture than Turso's token model
- better fit for externalized audit and log export
- database branching for review, rehearsals, and incident response

Turso is still the right fit for the community side because Pirate wants:

- one operational handoff unit per community
- SQLite/libSQL-compatible local development
- Turso group transfer for sovereignty handoff
- per-community storage isolation without one giant shared tenant database

## Scope

Neon applies only to the central Pirate control plane.

Turso still applies to:

- per-community primary databases
- group creation and transfer
- per-community runtime credentials
- community-local durable state

This ADR keeps community authority inside the Neon/Turso model. It does not introduce a second registry plane.

## Role Model

The control plane must not use Neon default admin-like roles for application traffic.

Minimum role split:

- `control_plane_owner`
  break-glass only; not used by app runtime, background jobs, CI, or migrations
- `control_plane_migrator`
  schema migrations and privileged maintenance only; no request traffic
- `control_plane_api_rw`
  normal API writes; no DDL; no role management; no bypass of RLS
- `control_plane_api_ro`
  read-only runtime surfaces that do not need writes
- `control_plane_ops_ro`
  narrow operator or support reads, only if direct SQL access is truly required

Hard rules:

- no app connection may use `neon_superuser` or any default broad role
- no shared password across admin and runtime roles
- migration credentials stay outside the public API runtime
- break-glass credentials live outside normal service secret paths and require human approval

## RLS Posture

RLS is required on the control-plane tables that carry the highest blast radius.

At minimum:

- `community_db_credentials`
- `community_database_bindings`
- `auth_provider_links`
- `verification_sessions`
- `user_attestations`
- `jobs`
- `audit_log`

Recommended posture:

- enable RLS with default deny
- use `FORCE ROW LEVEL SECURITY` on crown-jewel tables so table ownership does not quietly bypass policy
- write policies against explicit runtime roles, not broad inherited roles
- treat admin or migrator access as exceptional, not normal

RLS is not a substitute for service boundaries.

Pirate should still route most control-plane writes through a small number of reviewed service paths, but Postgres policies add a second hard stop when application code drifts.

## Audit Requirements

The control plane needs both database-level auditability and semantic application auditability.

Required:

- enable `pgAudit` for write-class statements at minimum
- export database logs outside the database account boundary
- alert on break-glass role use, failed auth spikes, and DDL in production
- keep an append-only application audit table for semantic events
- tie every sensitive mutation to `actor_type`, `actor_id`, `request_id`, and target identifiers

Important distinction:

- `pgAudit` explains what SQL executed
- Pirate's `audit_log` explains why the product changed state

Both are required.

The database audit trail must not be the only source, and the app audit table must not be the only source.

## Branching Rules

Neon branching is useful, but on the control plane it is also dangerous.

Rules:

- production remains the only writable production branch
- branches from production require an owner, purpose, and expiry
- long-lived feature branches must not carry fresh production data
- support or forensic branches with production data are time-boxed and access-reviewed
- branch creation for incident response is audited like a privileged operation

## Secret And Env Posture

Use vendor-neutral names for the control-plane runtime surface even if Neon is the provider.

Recommended secrets:

- `CONTROL_PLANE_DATABASE_URL`
  least-privilege runtime connection string for `control_plane_api_rw` or `control_plane_api_ro`
- `CONTROL_PLANE_MIGRATOR_DATABASE_URL`
  private connection string for `control_plane_migrator`
- `CONTROL_PLANE_OWNER_DATABASE_URL`
  break-glass owner connection string stored outside normal service paths; not used by runtime, CI, or routine migrations
- `TURSO_PLATFORM_API_TOKEN`
  still required for community Turso provisioning
- `TURSO_COMMUNITY_DB_WRAP_KEY`
  still required to envelope-encrypt stored community database credentials

Important difference from the old Turso control-plane model:

- the Postgres connection string is now a secret because it carries password-bearing credentials
- the control-plane database host or project identifier may remain non-secret config when separated from credentials

## Migration Shape

The migration from Turso control plane to Neon should be treated as a trust-boundary upgrade, not a simple driver swap.

Recommended sequence:

1. Freeze further schema drift in the Turso control-plane model.
2. Translate the control-plane schema from SQLite assumptions to explicit Postgres DDL.
3. Create roles, grants, and RLS policies before first production data load.
4. Enable `pgAudit` and external log export before cutover.
5. Backfill or replay existing control-plane data into Neon.
6. Cut API runtime traffic to Neon using least-privilege runtime credentials.
7. Retire the old central Turso control-plane credential and remove it from runtime secret paths.

## Consequences

Good:

- stronger least-privilege controls for the highest-value database
- better incident forensics
- cleaner separation between admin, migration, runtime, and support access
- safer branching for rehearsals and investigations

Costs:

- higher cost than Turso
- more operational ceremony around roles and audit
- the central database is no longer SQLite/libSQL-compatible
- schema and migration tooling must now account for Postgres features directly
