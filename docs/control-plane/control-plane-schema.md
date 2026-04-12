# Control-Plane Schema

Defines the first concrete relational schema for Pirate's central control-plane database.

This is the logical schema spec for Pirate's Neon-backed root-of-trust control plane. See [control-plane-neon-adr.md](/home/t42/Documents/pirate-v2/docs/control-plane-neon-adr.md).

Related:

- [turso-sovereignty-adr.md](/home/t42/Documents/pirate-v2/docs/turso-sovereignty-adr.md)
- [turso-data-boundaries.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-data-boundaries.md)
- [turso-secret-contract.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-secret-contract.md)
- [turso-provisioning-contract.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-provisioning-contract.md)
- [user.md](/home/t42/Documents/pirate-v2/specs/domain/user.md)
- [community.md](/home/t42/Documents/pirate-v2/specs/domain/community.md)

## Purpose

This is the schema spec for the central Pirate-owned database.

It is responsible for:

- platform identity
- upstream auth links
- verification workflow state
- community registry and routing
- encrypted community database credentials
- scrobble ingest and anchor state
- global track onchain registration state
- cross-community projections
- platform jobs and audit state

It is not the canonical home for community-local posts, memberships, moderation, or community-owned commerce rows.

## Storage Model

Target database:

- Neon Postgres
- Postgres-compatible schema, index, and privilege rules

ID posture:

- all primary keys are Pirate-issued opaque text IDs
- mutable labels, routes, and display names must not be primary keys
- Turso group and database names are infrastructure identifiers, not application IDs

Timestamp posture:

- every durable row gets `created_at`
- mutable rows get `updated_at`
- all control-plane timestamp columns use `timestamptz`
- lifecycle rows use explicit terminal timestamps such as `revoked_at`, `transferred_at`, or `invalidated_at`

JSON posture:

- JSON is allowed for derived read models and provider payload snapshots
- JSON must not replace core relational ownership or uniqueness constraints

## Source Of Truth Rules

Canonical relational sources:

- `users` is the source of truth for Pirate user identity
- `wallet_attachments` is the source of truth for linked wallets
- `auth_provider_links` is the source of truth for upstream auth identities
- `verification_sessions` and `user_attestations` are the workflow and attestation sources of truth for verification
- `namespace_verification_sessions`, `namespace_verifications`, and their evidence tables are the source of truth for external namespace root proof and accepted namespace-attachment authority
- `communities` is the source of truth for club-to-database routing
- `community_money_policies` is the source of truth for explicit attached community funding policy overrides
- `community_database_bindings` and `community_db_credentials` are the source of truth for active community database connection metadata
- `scrobble_ingest_events` is the source of truth for accepted scrobble ingest rows
- `track_anchor_state` is the source of truth for Pirate's confirmed view of global onchain track registration state

Derived state:

- `users.verification_capabilities_json` is a derived cache
- `users.verification_state` is a derived summary
- central feed/search/discovery projections are derived read models

This is the v0 answer to the `verification_capabilities` storage question:

- normalized session and attestation rows are canonical
- the user row carries a compact derived JSON capability view for fast reads
- capability JSON is regenerated from accepted attestation/session state, not hand-edited independently

## Core Tables

### `users`

Purpose:

- canonical Pirate user identity

Columns:

- `user_id` text primary key
- `primary_wallet_attachment_id` text nullable
- `verification_state` text not null
- `capability_provider` text nullable
- `verification_capabilities_json` jsonb not null
- `verified_at` timestamptz nullable
- `nationality` text nullable
- `current_verification_session_id` text nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `primary_wallet_attachment_id -> wallet_attachments.wallet_attachment_id`
- foreign key `current_verification_session_id -> verification_sessions.verification_session_id`
- index on `verification_state`

Notes:

- `verification_capabilities_json` stores the provider-neutral capability read model from [user.md](/home/t42/Documents/pirate-v2/specs/domain/user.md)
- sensitive provider fields such as raw nullifiers or full DOB are not duplicated here unless the user spec explicitly requires them on the canonical row

### `wallet_attachments`

Purpose:

- wallet attachment history and wallet-selection state

Columns:

- `wallet_attachment_id` text primary key
- `user_id` text not null
- `chain_namespace` text not null
- `wallet_address_normalized` text not null
- `wallet_address_display` text not null
- `source_provider` text nullable
- `source_subject` text nullable
- `attachment_kind` text not null
- `is_primary` integer not null
- `status` text not null
- `attached_at` timestamptz not null
- `detached_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- unique partial index on `(user_id, chain_namespace, wallet_address_normalized)` where `status = 'active'`
- unique partial index on `(user_id)` where `status = 'active' and is_primary = 1`
- index on `(user_id, chain_namespace)`

Notes:

- `wallet_address_display` preserves the preferred checksum or display form
- `source_provider` may be `privy`, `external`, or another upstream custody source later
- `attachment_kind` should distinguish at least `embedded` vs `external` in v0
- provider-specific signing metadata such as the Privy wallet id or wallet public key should live in `wallet_attachment_provider_state`, not on the canonical wallet attachment row

### `wallet_attachment_provider_state`

Purpose:

- provider-specific sidecar state for a canonical wallet attachment
- lazy-created Sentinel wallet metadata needed for future signing

Columns:

- `wallet_attachment_id` text primary key
- `provider` text not null
- `provider_wallet_id` text not null
- `provider_chain_type` text not null
- `public_key_hex` text not null
- `external_wallet_ref` text nullable
- `metadata_json` jsonb nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `wallet_attachment_id -> wallet_attachments.wallet_attachment_id`
- unique index on `(provider, provider_wallet_id)`

Notes:

- this table is the recommended place to persist Privy Cosmos wallet metadata for Sentinel dVPN
- Pirate should create rows here only after the user has a paid dVPN entitlement and the lazy wallet ensure flow runs

### `auth_provider_links`

Purpose:

- upstream auth subject linkage for login/bootstrap

Columns:

- `auth_provider_link_id` text primary key
- `user_id` text not null
- `provider` text not null
- `provider_subject` text not null
- `provider_user_ref` text nullable
- `status` text not null
- `linked_at` timestamptz not null
- `revoked_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- unique partial index on `(provider, provider_subject)` where `status = 'active'`
- index on `(user_id, provider)`

Notes:

- first executable slice uses `jwt`
- Privy is still an expected upstream provider in the broader v0 product direction
- this table exists so upstream auth remains an attachment, not the user primary key

### `verification_sessions`

Purpose:

- provider-backed verification workflow lifecycle

Columns:

- `verification_session_id` text primary key
- `user_id` text not null
- `provider` text not null
- `session_kind` text not null
- `requested_capabilities_json` jsonb not null
- `status` text not null
- `upstream_session_ref` text nullable
- `result_ref` text nullable
- `failure_code` text nullable
- `wallet_attachment_id` text nullable
- `verification_intent` text nullable
- `policy_id` text nullable
- `started_at` timestamptz not null
- `completed_at` timestamptz nullable
- `expires_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- index on `(user_id, status)`
- index on `(provider, upstream_session_ref)`

Notes:

- this is the workflow record, not the long-term attestation inventory
- `requested_capabilities_json` records what the product asked for at verification time
- `wallet_attachment_id` records the attached wallet selected for wallet-coupled verification flows when present

### `user_attestations`

Purpose:

- durable provider-backed attestation inventory

Columns:

- `user_attestation_id` text primary key
- `user_id` text not null
- `source_verification_session_id` text nullable
- `provider` text not null
- `attestation_type` text not null
- `capability_key` text nullable
- `status` text not null
- `value_json` jsonb not null
- `verified_at` timestamptz nullable
- `expires_at` timestamptz nullable
- `revoked_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- foreign key `source_verification_session_id -> verification_sessions.verification_session_id`
- index on `(user_id, provider, attestation_type)`
- index on `(user_id, capability_key, status)`

Notes:

- provider-specific raw facts live here
- `users.verification_capabilities_json` is derived from the accepted subset of these rows plus current verification-session outcomes

### `profiles`

Purpose:

- global profile state separate from the canonical user row

Columns:

- `user_id` text primary key
- `display_name` text nullable
- `bio` text nullable
- `avatar_ref` text nullable
- `cover_ref` text nullable
- `global_handle_id` text nullable

## Namespace Verification

### `namespace_verification_sessions`

Purpose:

- workflow record for HNS namespace verification before a root can be attached to a club

Columns:

- `namespace_verification_session_id` text primary key
- `namespace_verification_id` text nullable
- `user_id` text not null
- `family` text not null
- `submitted_root_label` text not null
- `normalized_root_label` text nullable
- `status` text not null
- `challenge_host` text nullable
- `challenge_txt_value` text nullable
- `challenge_expires_at` timestamptz nullable
- `root_exists` integer nullable
- `root_control_verified` integer nullable
- `expiry_horizon_sufficient` integer nullable
- `routing_enabled` integer nullable
- `pirate_dns_authority_verified` integer nullable
- `club_attach_allowed` integer nullable
- `pirate_web_routing_allowed` integer nullable
- `pirate_subdomain_issuance_allowed` integer nullable
- `control_class` text nullable
- `operation_class` text nullable
- `observation_provider` text nullable
- `evidence_bundle_ref` text nullable
- `failure_reason` text nullable
- `accepted_at` timestamptz nullable
- `expires_at` timestamptz not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- unique partial index on `(namespace_verification_id)` where not null
- index on `(user_id, status)`
- index on `(normalized_root_label, status)`

Notes:

- this is the explicit namespace-verification workflow record that produces `namespace_verification_id`
- public v0 currently supports `family = 'hns'`
- session state mirrors the HNS verification flow spec rather than the provider-backed user-verification state machine
- `challenge_expires_at` tracks TXT-challenge expiry independently from the broader session `expires_at`
- `namespace_verification_id` is unique when present, but it is not declared as a reverse foreign key to `namespace_verifications` because acceptance creates both sides of that linkage in the same transition and the control plane should not depend on deferred circular constraints in SQLite

### `namespace_verifications`

Purpose:

- accepted namespace-verification references consumed by `POST /communities`

Columns:

- `namespace_verification_id` text primary key
- `source_namespace_verification_session_id` text not null
- `user_id` text not null
- `family` text not null
- `normalized_root_label` text not null
- `status` text not null
- `root_exists` integer not null
- `root_control_verified` integer not null
- `expiry_horizon_sufficient` integer not null
- `routing_enabled` integer not null
- `pirate_dns_authority_verified` integer not null
- `club_attach_allowed` integer not null
- `pirate_web_routing_allowed` integer not null
- `pirate_subdomain_issuance_allowed` integer not null
- `control_class` text nullable
- `operation_class` text nullable
- `observation_provider` text nullable
- `evidence_bundle_ref` text nullable
- `accepted_at` timestamptz not null
- `expires_at` timestamptz not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `source_namespace_verification_session_id -> namespace_verification_sessions.namespace_verification_session_id`
- foreign key `user_id -> users.user_id`
- unique index on `(source_namespace_verification_session_id)`
- index on `(user_id, status)`
- index on `(normalized_root_label, status)`

Notes:

- this is the accepted verification object the create-community API must resolve and re-check at create time
- the row preserves both assertions and derived capabilities so create and later revalidation can fail closed without reconstructing past state from scratch
- accepted-verification rows are the target of foreign keys from evidence, assertion, and revalidation tables once they exist; session-scoped rows may still be written before acceptance

### `namespace_verification_evidence_bundles`

Purpose:

- immutable or append-only raw observation snapshots for namespace verification

Columns:

- `evidence_bundle_id` text primary key
- `namespace_verification_session_id` text not null
- `namespace_verification_id` text nullable
- `family` text not null
- `normalized_root_label` text nullable
- `evidence_kind` text not null
- `provider` text nullable
- `resolver_path_json` text nullable
- `raw_response_json` text nullable
- `evidence_hash` text nullable
- `observed_at` timestamptz not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `namespace_verification_session_id -> namespace_verification_sessions.namespace_verification_session_id`
- foreign key `namespace_verification_id -> namespace_verifications.namespace_verification_id`
- index on `(namespace_verification_session_id, observed_at desc)`
- index on `(namespace_verification_id, observed_at desc)`

Notes:

- public v0 records the trusted provider and raw observation payload here so Fire HSD-backed verification remains auditable
- one accepted verification may accumulate multiple evidence bundles across initial verification and later revalidation

### `namespace_verification_assertions`

Purpose:

- normalized assertion history derived from evidence bundles

Columns:

- `assertion_record_id` text primary key
- `namespace_verification_session_id` text not null
- `namespace_verification_id` text nullable
- `assertion_name` text not null
- `assertion_value` integer nullable
- `source_evidence_bundle_id` text nullable
- `status` text not null
- `first_accepted_at` timestamptz nullable
- `last_revalidated_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `namespace_verification_session_id -> namespace_verification_sessions.namespace_verification_session_id`
- foreign key `namespace_verification_id -> namespace_verifications.namespace_verification_id`
- foreign key `source_evidence_bundle_id -> namespace_verification_evidence_bundles.evidence_bundle_id`
- index on `(namespace_verification_session_id, assertion_name)`
- index on `(namespace_verification_id, assertion_name, status)`

Notes:

- assertions stay normalized so drift and contradiction can be audited independently of the accepted verification summary row

### `namespace_verification_revalidation_events`

Purpose:

- explicit history of namespace-verification drift and capability changes after acceptance

Columns:

- `revalidation_event_id` text primary key
- `namespace_verification_id` text not null
- `trigger` text not null
- `old_assertions_json` text nullable
- `new_assertions_json` text nullable
- `old_capabilities_json` text nullable
- `new_capabilities_json` text nullable
- `old_status` text nullable
- `new_status` text not null
- `source_evidence_bundle_id` text nullable
- `created_at` timestamptz not null

Constraints and indexes:

- foreign key `namespace_verification_id -> namespace_verifications.namespace_verification_id`
- foreign key `source_evidence_bundle_id -> namespace_verification_evidence_bundles.evidence_bundle_id`
- index on `(namespace_verification_id, created_at desc)`

Notes:

- this table is how the control plane explains why a root moved from `verified` to `stale`, `expired`, or `disputed`
- create-time rechecks may emit revalidation events when they materially downgrade a previously accepted verification

### `global_handles`

Purpose:

- global `.pirate` handle ownership

Columns:

- `global_handle_id` text primary key
- `user_id` text not null
- `label_normalized` text not null
- `label_display` text not null
- `status` text not null
- `tier` text not null
- `issuance_source` text not null
- `redirect_target_global_handle_id` text nullable
- `price_paid_usd` real nullable
- `free_rename_consumed` integer not null
- `issued_at` timestamptz not null
- `replaced_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `user_id -> users.user_id`
- foreign key `redirect_target_global_handle_id -> global_handles.global_handle_id`
- unique partial index on `(label_normalized)` where `status = 'active'`
- unique partial index on `(user_id)` where `status = 'active'`

Notes:

- `status` matches the global `.pirate` handle lifecycle from the profile domain spec: `active`, `redirect`, `retired`
- `tier` includes the generated signup tier so auth exchange can persist the initial fallback identity without a second bootstrap path
- `issuance_source` follows the global handle-specific enum rather than reusing community-handle issuance values

## Community Registry And Routing

### `communities`

Purpose:

- central registry row for every club/community regardless of where its durable community data lives

Columns:

- `community_id` text primary key
- `creator_user_id` text not null
- `display_name` text not null
- `status` text not null
- `provisioning_state` text not null
- `transfer_state` text not null
- `route_slug` text nullable
- `namespace_verification_id` text nullable
- `primary_database_binding_id` text nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `creator_user_id -> users.user_id`
- index on `(status, provisioning_state)`
- unique partial index on `(route_slug)` where `route_slug is not null`

Notes:

- this row exists before the community DB is fully live so the control plane has a stable `community_id`
- the canonical community content still lives in the community DB after provisioning completes
- `namespace_verification_id` references an accepted row in `namespace_verifications`
- because the column existed before the namespace-verification tables were introduced, migration `0005` enforces existence with insert and update triggers plus an index rather than rebuilding the table solely to add a foreign key

### `community_database_bindings`

Purpose:

- current and historical mapping from `community_id` to Turso group/database endpoints

Columns:

- `community_database_binding_id` text primary key
- `community_id` text not null
- `binding_role` text not null
- `organization_slug` text not null
- `group_name` text not null
- `group_id` text nullable
- `database_name` text not null
- `database_id` text nullable
- `database_url` text not null
- `location` text nullable
- `status` text not null
- `transferred_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- unique partial index on `(community_id, binding_role)` where `status = 'active'`
- unique partial index on `(organization_slug, group_name, database_name)` where `status in ('active', 'pending_transfer')`

Notes:

- v0 uses one active binding with `binding_role = 'primary'`
- transfer history stays here even after a group moves to another org

### `community_money_policies`

Purpose:

- explicit attached community funding-policy overrides used by quote generation and external routed-funding eligibility

Columns:

- `community_id` text primary key
- `funding_preference` text not null
- `accepted_funding_assets_json` jsonb not null
- `accepted_source_chains_json` jsonb not null
- `approved_route_providers_json` jsonb nullable
- `destination_settlement_chain_json` jsonb not null
- `destination_settlement_token` text not null
- `treasury_denomination` text nullable
- `max_slippage_bps` integer not null
- `quote_ttl_seconds` integer not null
- `route_required` integer not null
- `route_status_policy` text not null
- `route_hop_tolerance` integer not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- index on `(route_required, updated_at desc)`

Notes:

- this table is intentionally attached to `communities` rather than expanding the community core row into a route object
- when no row exists, the API/runtime resolves the platform default money policy with `policy_origin = default`
- stored JSON fields are attached policy payloads, not replacements for the canonical `community_id` ownership relationship

### `community_db_credentials`

Purpose:

- encrypted per-community runtime credential inventory

Columns:

- `community_db_credential_id` text primary key
- `community_database_binding_id` text not null
- `credential_kind` text not null
- `token_name` text not null
- `encrypted_token` text not null
- `encryption_key_version` integer not null
- `token_scope` text not null
- `status` text not null
- `issued_at` timestamptz not null
- `invalidated_at` timestamptz nullable
- `expires_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_database_binding_id -> community_database_bindings.community_database_binding_id`
- unique partial index on `(community_database_binding_id)` where `status = 'active'`
- unique index on `(token_name)`

Notes:

- the plaintext token never persists here
- the token ciphertext is encrypted with `TURSO_COMMUNITY_DB_WRAP_KEY`
- v0 runtime posture is one active database-scoped token per primary community DB

## Cross-Community Read Models

### `community_post_projections`

Purpose:

- central projection rows for cross-community feed/search/discovery

Columns:

- `projection_id` text primary key
- `community_id` text not null
- `source_post_id` text not null
- `author_user_id` text nullable
- `identity_mode` text not null
- `post_type` text not null
- `status` text not null
- `source_created_at` timestamptz not null
- `projected_payload_json` jsonb not null
- `projection_version` integer not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- index on `(community_id, source_created_at desc)`
- index on `(status, source_created_at desc)`
- unique index on `(community_id, source_post_id, projection_version)`

Notes:

- this is not the canonical post store
- this table exists so global surfaces never need cross-database joins at request time

### `community_membership_projections`

Purpose:

- central denormalized view for `Your Communities`, gating hints, and discovery summaries

Columns:

- `projection_id` text primary key
- `community_id` text not null
- `user_id` text not null
- `membership_state` text not null
- `role_summary_json` jsonb nullable
- `source_updated_at` timestamptz not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- foreign key `user_id -> users.user_id`
- unique index on `(community_id, user_id)`
- index on `(user_id, membership_state)`

## Scrobble Ingest And Anchor State

### `scrobble_ingest_events`

Purpose:

- canonical accepted scrobble ingest rows

Reference DDL:

```sql
CREATE TABLE scrobble_ingest_events (
    scrobble_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    community_id TEXT,
    source_type TEXT NOT NULL,
    playback_started_at TIMESTAMPTZ NOT NULL,
    playback_position_ms INTEGER,
    credited_duration_ms INTEGER,
    ingestion_mode TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    anchor_status TEXT NOT NULL DEFAULT 'queued',
    anchor_attempt_count INTEGER NOT NULL DEFAULT 0,
    wallet_attachment_id TEXT,
    accepted_at TIMESTAMPTZ NOT NULL,
    anchored_at TIMESTAMPTZ,
    chain_tx_hash TEXT,
    chain_log_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (wallet_attachment_id) REFERENCES wallet_attachments(wallet_attachment_id)
);

CREATE UNIQUE INDEX idx_scrobble_idempotency
    ON scrobble_ingest_events(user_id, idempotency_key);

CREATE INDEX idx_scrobble_anchor_status
    ON scrobble_ingest_events(anchor_status, accepted_at);

CREATE INDEX idx_scrobble_user_status
    ON scrobble_ingest_events(user_id, anchor_status);

CREATE INDEX idx_scrobble_wallet_anchor
    ON scrobble_ingest_events(wallet_attachment_id, anchor_status)
    WHERE anchor_status IN ('queued', 'awaiting_track', 'awaiting_wallet');
```

Notes:

- `updated_at` is required because `anchor_status` is mutable
- `wallet_attachment_id` is internal anchor state and is not part of the public API shape
- `accepted_at` is the canonical ingest timestamp for product logic
- `chain_tx_hash` plus `chain_log_index` identify the anchored event within a batch tx
- `anchor_status` should at least support `queued`, `awaiting_wallet`, `awaiting_track`, `anchoring`, `anchored`, `failed`, and `suppressed`
- `anchor_attempt_count` bounds retry loops and should increment on each anchor attempt

### `scrobble_anchor_batches`

Purpose:

- internal batch-publication lifecycle for `ScrobbleV1` anchoring

Reference DDL:

```sql
CREATE TABLE scrobble_anchor_batches (
    batch_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    publisher_kind TEXT NOT NULL,
    chain_id INTEGER NOT NULL DEFAULT 1315,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    error_code TEXT,
    item_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_batch_status
    ON scrobble_anchor_batches(status, created_at);
```

Notes:

- `publisher_kind` distinguishes `direct-key` from a future `pkp` publisher
- `wallet_address` is the resolved onchain user address used for this batch
- `item_count` is denormalized for monitoring and debugging
- this is internal infrastructure state, not a user-visible job row

### `scrobble_anchor_batch_items`

Purpose:

- link table from ingest rows to anchor batches and confirmed event positions

Reference DDL:

```sql
CREATE TABLE scrobble_anchor_batch_items (
    batch_id TEXT NOT NULL,
    scrobble_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    event_log_index INTEGER,
    PRIMARY KEY (batch_id, scrobble_id),
    FOREIGN KEY (batch_id) REFERENCES scrobble_anchor_batches(batch_id),
    FOREIGN KEY (scrobble_id) REFERENCES scrobble_ingest_events(scrobble_id)
);

CREATE INDEX idx_batch_item_scrobble
    ON scrobble_anchor_batch_items(scrobble_id);
```

Notes:

- `item_index` is the position within the calldata arrays for the batch call
- `event_log_index` is populated after confirmation from the tx receipt

### `track_anchor_state`

Purpose:

- confirmed central view of global `ScrobbleV1` track registration state

Reference DDL:

```sql
CREATE TABLE track_anchor_state (
    track_id TEXT PRIMARY KEY,
    metadata_hash TEXT NOT NULL,
    registration_status TEXT NOT NULL DEFAULT 'not_registered',
    registered_tx_hash TEXT,
    registered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_track_reg_status
    ON track_anchor_state(registration_status)
    WHERE registration_status = 'not_registered';
```

Notes:

- `registration_status` should support at least `not_registered`, `registering`, and `registered`
- this table is an optimization and durable cache, not a substitute for authoritative onchain checks
- the anchor worker should still tolerate the `TrackAlreadyRegistered` race and treat it as concurrent success

### `projection_outbox`

Purpose:

- durable projection work queue for scrobble-derived central and community read models

Reference DDL:

```sql
CREATE TABLE projection_outbox (
    outbox_id TEXT PRIMARY KEY,
    target_scope TEXT NOT NULL,
    target_id TEXT NOT NULL,
    projection_kind TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_outbox_status
    ON projection_outbox(status, created_at);

CREATE INDEX idx_outbox_target
    ON projection_outbox(target_scope, target_id);
```

Notes:

- `target_scope` should distinguish at least `club` and `global`
- `projection_kind` may include `recent_listeners`, `club_charts`, `user_scrobble_count`, and `track_listener_count`
- this follows the same central-projection pattern already used for community post projections

### Anchor Worker Claim Pattern

The anchor worker claims rows using status-transition claims, not `SELECT FOR UPDATE`.

Reference pattern:

```sql
UPDATE scrobble_ingest_events
SET anchor_status = 'anchoring',
    anchor_attempt_count = anchor_attempt_count + 1,
    updated_at = ?
WHERE scrobble_id IN (
    SELECT scrobble_id
    FROM scrobble_ingest_events
    WHERE wallet_attachment_id = ?
      AND anchor_status = 'queued'
    LIMIT ?
);
```

Flow:

1. Claim a wallet-scoped batch by updating `anchor_status` from `queued` to `anchoring`.
2. Read the claimed rows outside the transaction.
3. Register missing tracks first, then submit `scrobbleBatch(...)`.
4. On confirmation, set `anchor_status = 'anchored'` and populate `anchored_at`, `chain_tx_hash`, and `chain_log_index`.
5. On failure:
   - retryable failures return to `queued` with backoff
   - permanent infrastructure failures move to `failed`
   - fraud or post-acceptance suppression moves to `suppressed`

Notes:

- SQLite/libSQL does not guarantee `UPDATE ... LIMIT` support in every build, so the subquery pattern above is the safe baseline
- `TrackAlreadyRegistered` should be handled as successful concurrent registration rather than a terminal failure
- normal anchor batches are internal operator state, not rows in the public `jobs` table

## Jobs And Audit

### `jobs`

Purpose:

- pollable platform job lifecycle

Columns:

- `job_id` text primary key
- `job_type` text not null
- `job_scope` text not null
- `community_id` text nullable
- `subject_type` text not null
- `subject_id` text not null
- `status` text not null
- `payload_json` jsonb nullable
- `result_ref` text nullable
- `error_code` text nullable
- `attempt_count` integer not null
- `available_at` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- index on `(status, available_at)`
- index on `(subject_type, subject_id)`
- index on `(community_id, status)`

Notes:

- `job_scope = 'platform'` means the side effects are central
- `job_scope = 'community'` means the orchestration record is central even if the durable side effects occur in a community DB

### `audit_log`

Purpose:

- durable operator and automation audit trail

Columns:

- `audit_event_id` text primary key
- `actor_type` text not null
- `actor_id` text nullable
- `action` text not null
- `target_type` text not null
- `target_id` text not null
- `community_id` text nullable
- `metadata_json` jsonb nullable
- `created_at` timestamptz not null

Constraints and indexes:

- foreign key `community_id -> communities.community_id`
- index on `(actor_id, created_at desc)`
- index on `(target_type, target_id, created_at desc)`
- index on `(community_id, created_at desc)`

## Community Database Minimum

This file is about the central DB, but the v0 architecture is incomplete unless the community DB minimum is also named.

Each community primary database should have, at minimum:

- `communities`
- `club_memberships`
- `membership_requests`
- `club_roles`
- `namespace_bindings`
- `namespace_handle_policies`
- `club_handles`
- `labels`
- `posts`
- `post_votes`
- `post_reactions`
- `moderation_actions`
- `community_jobs`
- `purchases`
- `purchase_entitlements`

Those tables are the durable sovereignty payload. They do not belong in the central DB except as projections or routing metadata.

## Bootstrap Fixtures

The first fixture set should cover at least:

- `user_a` with one primary wallet attachment
- `user_b` with one primary wallet attachment
- one secondary wallet attachment on `user_a`
- one revoked wallet attachment row
- one active `privy` auth-provider link
- one pending verification session
- one verified attestation set that produces `verification_capabilities_json`
- one `communities` row in `requested`
- one `communities` row in `active`
- one active `community_database_binding`
- one active encrypted `community_db_credential`

These fixtures are enough to test auth bootstrap, wallet selection, verification derivation, and community routing without any live provider dependency.

## Hard Rules

- no community database credential is stored plaintext at rest
- no live request path requires joining central SQL to community SQL
- no community DB may redefine the canonical `user_id`
- no mutable route or display label may be the only link between a club and its Turso group
- no projection row is treated as the source of truth over the originating central or community row
