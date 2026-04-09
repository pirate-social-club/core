# Community Registry Plane

Status: draft

Related docs:

- [turso-sovereignty-adr.md](/home/t42/Documents/pirate-v2/docs/turso-sovereignty-adr.md)
- [turso-data-boundaries.md](/home/t42/Documents/pirate-v2/docs/turso-data-boundaries.md)
- [turso-control-plane-schema.md](/home/t42/Documents/pirate-v2/docs/turso-control-plane-schema.md)
- [../specs/api/mpp.md](/home/t42/Documents/pirate-v2/specs/api/mpp.md)
- [../specs/domain/community.md](/home/t42/Documents/pirate-v2/specs/domain/community.md)
- [../specs/domain/governance-backends.md](/home/t42/Documents/pirate-v2/specs/domain/governance-backends.md)
- [../specs/domain/namespace-root-control.md](/home/t42/Documents/pirate-v2/specs/domain/namespace-root-control.md)
- [../specs/domain/hns-verification-flow.md](/home/t42/Documents/pirate-v2/specs/domain/hns-verification-flow.md)
- [../specs/domain/livestream.md](/home/t42/Documents/pirate-v2/specs/domain/livestream.md)
- [../specs/domain/handles.md](/home/t42/Documents/pirate-v2/specs/domain/handles.md)
- [../specs/domain/donations.md](/home/t42/Documents/pirate-v2/specs/domain/donations.md)

## Purpose

This doc defines Pirate's public community registry plane.

It answers:

- what public club state should be authoritative on Tableland
- what must remain authoritative in Turso
- what belongs behind MPP or x402 machine-access products
- how governance-backed communities own and transfer the public registry
- how Tableland rows, Turso operational state, and Story execution state fit together

## Core Principle

Pirate should not treat all public-looking data the same.

There are three distinct planes:

1. `registry plane`
   Public, auditable, community-owned metadata and configuration.
2. `operational plane`
   Private, latency-sensitive, high-churn, or secret-bearing state.
3. `corpus plane`
   High-value machine-access products such as export, archive, and search.

Recommended v0 mapping:

- `registry plane` = Tableland-authoritative
- `operational plane` = Turso-authoritative
- `corpus plane` = Turso storage plus MPP access policy

This means Tableland is not the database for all of Pirate.
It is the public registry for communities.

Important refinement:

- the canonical public registry for a club lives in community-scoped Tableland tables
- shared cross-community discovery indexes may also exist on Tableland, but those are derived read models, not the sovereignty boundary

## Why Tableland

For the public registry plane, Tableland is better than Turso because:

- tables are owned as ERC-721 tokens
- table ownership can be transferred onchain
- controllers can enforce row-level policy
- public reads are naturally agent-accessible
- club ownership is provable instead of being an operator promise

This is structurally better than a Pirate-owned hosted account for public club identity and governance metadata.

## Table Granularity

Shared tables and ownership-transfer goals are in tension.

Why:

- Tableland table ownership is ERC-721 ownership of the whole table
- ownership transfer does not happen per row
- a shared table cannot be transferred club-by-club without transferring every club row in that table

Recommended v0 resolution:

- per-community canonical registry tables for sovereignty-critical public state
- shared Pirate-owned discovery index tables for cross-community query ergonomics

Interpretation:

- each club gets its own canonical public-registry tables
- those tables are the public source of truth for that club's registry state
- ownership of those tables transfers with governance upgrade
- shared discovery tables are rebuilt or updated from the canonical per-community tables
- shared discovery tables are useful for agents, but they are not the sovereignty boundary

Recommended canonical per-community tables:

- `club_registry_current_<tableId>`
- `club_reference_links_current_<tableId>`
- `club_rules_current_<tableId>`
- `club_resource_links_current_<tableId>`
- `club_namespace_current_<tableId>`
- `livestream_public_current_<tableId>`

Intentional reduction:

- one-row-per-community registry summaries are merged into `club_registry_current_<tableId>`
- this keeps the core public identity and policy transfer surface compact
- a governance upgrade can transfer one primary registry table instead of several one-row side tables
- separate per-community tables remain only where the dataset is naturally multi-row or has distinct mutation semantics
- namespace stays separate even in v0 because it is platform-derived, has distinct verification semantics, and may grow beyond a single primary row once mirrors or additional namespace surfaces exist

Recommended shared discovery indexes:

- `clubs_directory_current`
- `livestreams_directory_current`

Notes:

- per-community canonical tables give real ownership transfer
- shared indexes keep discovery queries ergonomic for agents
- the shared index is a public read model, analogous to the Turso cache pattern but still publicly queryable

## Authority Hierarchy

Pirate should use the following precedence order:

1. constitutional contract truth
2. Tableland registry truth
3. Turso operational truth
4. Turso cache of Tableland truth
5. MPP access policy for deep machine retrieval

Interpretation:

- a Safe or DAO contract is the constitutional truth for its signer or owner set
- Tableland is the public truth for selected community registry rows
- Turso is the product truth for operational and private state
- Turso may cache Tableland for app performance, but cache never outranks Tableland

## Chain Topology

Recommended topology:

- Story
  IP, settlement, scrobbles, CDR, entitlement execution
- Tableland-supported EVM chain
  public club registry tables and registry-management contracts
- Turso
  private operational and app state

This is a deliberate three-plane design.

Important:

- `community_id` is the join key across all three planes
- `community_id` remains the canonical product identifier
- `community_id` does not become an onchain-native identity in v0

## Dataset Matrix

| Dataset | Authoritative On | Public | Community-Owned | Notes |
|---|---|---|---|---|
| club public profile | Tableland | yes | yes | registry and discovery state |
| club rules current | Tableland | yes | yes | public club contract and onboarding metadata |
| club resource links current | Tableland | yes | yes | editorial public links only |
| identity-bearing club reference links current | Tableland | yes | yes | only derived public state |
| club reference-link proofs and review records | Turso | no | operational | proof machinery stays off the registry |
| namespace binding summary | Tableland | yes | yes | root label, route family, public status |
| namespace evidence bundle, assertions, capabilities | Turso | mostly no | operational audit | richer than the registry needs |
| governance backend pointer | Tableland | yes | yes | chain and contract address are public |
| constitutional signer or owner set | onchain contract | yes | yes | Safe or DAO is the real truth |
| observed signer snapshot | Tableland | yes | yes | mirror only, never superior to contract truth |
| donation public mode and partner status | Tableland | yes | yes | public policy only |
| donation partner entity and payout destination | Turso | no | operational | payout routing is not registry data |
| handle policy summary | Tableland | yes | yes | publish summary only |
| full handle policy object | Turso | mostly no | operational | nested pricing and reserved-label detail stays off the registry |
| scheduled or canceled livestream discovery | Tableland | yes | yes | event registry data |
| live runtime state | Turso or cache | yes | operational | latency-sensitive, not Tableland truth |
| operational roles and moderation roles | Turso | mixed | operational | not constitutional registry state |
| full membership state | Turso | no | operational | not part of the public registry by default |
| constitutional governance participants | onchain contract and Tableland pointer | yes | yes | public signers, treasury, DAO contract |
| aggregate member counts | Tableland or derived cache | yes | yes | good public signal |
| post or comment corpus | Turso plus MPP | human-readable but not free bulk | no | valuable corpus |
| corpus export, archive, search | MPP | paid | no | extraction layer |

## Tableland-Authoritative Datasets

### 1. Community public profile

Tableland should be authoritative for the public club profile:

- `display_name`
- `description`
- `avatar_ref`
- `cover_ref`
- public `status`
- `governance_mode`
- `updated_at`

Reasoning:

- this is public registry state
- it benefits from public auditability
- it should be easy for agents to discover and index

### 2. Community rules

Tableland should be authoritative for current public rules.

Reasoning:

- rules are public-facing club contract content
- they are meaningful to agents and external readers
- they are slow-changing enough to tolerate chain-mediated writes

Important distinction:

- rules belong here
- operational moderation policies and enforcement logs do not

### 3. Community resource links

Tableland should be authoritative for the club's `community_profile.resource_links`.

Reasoning:

- these are public editorial links
- [community.md](/home/t42/Documents/pirate-v2/specs/domain/community.md) explicitly distinguishes them from identity-bearing `club_reference_links`
- they are useful registry and discovery data

### 4. Community reference links with derived verification state

Identity-bearing `club_reference_links` need a split model:

- public link row and derived verification badge go on Tableland
- proof records, review notes, raw evidence, and workflow history stay in Turso

Tableland should carry:

- link platform
- URL
- display label
- public `verification_state`
- `verified_at`
- `last_checked_at`
- public active or archived status

Turso should carry:

- proof rows
- verifier notes
- challenge artifacts
- review history
- private failure diagnostics

Naming rule:

- use `club_reference_links` for identity-bearing public links
- use `resource_links` for editorial club profile links
- do not collapse the two concepts into one registry table name

### 5. Namespace binding summary

Tableland should be authoritative for the public namespace summary:

- root label
- normalized label
- route family
- namespace role
- public namespace status
- derived root proof status
- derived delegation status
- last verified timestamp

Do not move the full namespace proof model to Tableland.

The richer three-layer audit system remains in Turso:

- evidence bundle
- assertion record
- capability derivation

This remains a separate table instead of being merged into `club_registry_current_<tableId>` because:

- namespace publication is platform-derived rather than a normal club profile edit
- namespace rows already carry distinct verification state and lifecycle fields
- the model may need more than one namespace row per club even if most communities start with one in v0

### 6. Governance backend pointer

Tableland should be authoritative for the public governance pointer.

These fields should live on `club_registry_current_<tableId>` rather than in a dedicated one-row table:

- `governance_mode`
- `governance_chain_id`
- `governance_contract_address`
- `governance_treasury_address`
- `governance_verification_state`
- `last_verified_at`

Important rule:

- for `multisig` and `majeur`, the actual Safe or DAO contract remains the constitutional truth
- Tableland must not be treated as more authoritative than the backend contract it points to

Observed signer snapshots may be published for convenience, but they are mirrors only.

### 7. Donation public policy

Tableland should be authoritative for public donation policy state.

These fields should live on `club_registry_current_<tableId>` rather than in a dedicated one-row table:

- `donation_policy_mode`
- `donation_partner_status`

Do not publish:

- `payout_destination_ref`
- provider-specific payout routing details
- private partner review artifacts

Those remain in Turso per [donations.md](/home/t42/Documents/pirate-v2/specs/domain/donations.md).

### 8. Handle policy summary

Tableland should publish only a summary of handle policy, not the full nested policy object.

This summary should live on `club_registry_current_<tableId>` rather than in a dedicated one-row table.

Recommended public summary fields:

- `policy_template`
- `pricing_model`
- `claims_enabled`
- `premium_enabled`
- `auction_enabled`
- `updated_at`

The full policy remains in Turso because:

- it is nested and operationally complex
- evaluation happens in Pirate's backend
- the registry only needs the public-facing summary

### 9. Scheduled livestream discovery

Tableland should be authoritative for public livestream schedule discovery rows.

Recommended registry scope:

- scheduled
- canceled
- ended

Do not treat Tableland as the real-time truth for `live`.

Real-time liveness should come from Turso or a low-latency cache because:

- host-initiated state changes are latency-sensitive
- broadcast state is operational, not registry state

## Community Creation Sequence

Community creation is a two-plane operation.

Recommended v0 sequence:

1. User submits `POST /communities` through Pirate.
2. Pirate validates creator verification, namespace evidence, and creation policy.
3. Pirate creates the operational club row in Turso immediately.
4. Pirate marks the club's registry publication state as pending.
5. Pirate calls `ClubTableManagerV1.createClubTables(community_id, ...)` on the Tableland chain.
6. Tableland emits table-creation events and validators materialize the per-community canonical tables.
7. Pirate inserts the initial public registry rows through `ClubTableManagerV1`.
8. Pirate updates shared discovery index tables.
9. Turso cache and projection rows catch up from the finalized Tableland writes.
10. Pirate marks registry publication as published.

Important:

- the club exists in Turso before the public registry is fully materialized
- there is an expected temporary divergence window where operational truth exists but public registry truth is still pending
- public discovery should treat `pending` communities as not yet published

## Registry Publication State

Pirate should track publication state separately from club operational lifecycle.

Recommended central states:

- `pending_tableland_create`
- `pending_tableland_seed`
- `published`
- `publication_error`

Recommended behavior:

- community creation should not fail solely because Tableland publication is delayed after the Turso write succeeds
- instead, the club remains operationally created but publicly unpublished until reconciliation succeeds
- retry should happen through jobs or a control-plane reconciler

## Tableland Failure And Reconciliation

Recommended v0 posture:

- Tableland unavailability does not erase the Turso club create
- Pirate records the failed publication state and retries asynchronously
- shared discovery indexes must never publish a club whose canonical per-community tables were not successfully seeded

Recommended recovery mechanisms:

- background retry jobs
- operator-facing doctor or reconcile tooling
- periodic verification that each active club has seeded canonical tables and fresh shared-index rows

## What Stays Out Of Tableland

### Operational roles

Operational roles stay in Turso:

- moderators
- routine product admins
- post and member moderation permissions

Reason:

- [governance-backends.md](/home/t42/Documents/pirate-v2/specs/domain/governance-backends.md) explicitly separates operational and constitutional authority
- these roles are product-native and do not need chain-mediated writes in v0

### Full membership state

General membership does not belong in the public registry by default.

Reasons:

- membership is high-churn operational state
- wallets are attachments, not canonical user identity
- public membership lists create unnecessary social-graph leakage

Allowed public alternatives:

- aggregate member counts
- constitutional participant sets
- optional public opt-in membership later if product policy wants it

### Moderation and private governance reconciliation

Keep in Turso:

- bans
- strikes
- moderator notes
- governance action reconciliation internals
- proof records

### Corpus and extraction products

Keep off Tableland and meter through MPP:

- full post bodies at scale
- full comment and reply trees
- archive export
- corpus search
- transcript or lyric corpora
- large-scale scrobble analytics

This aligns with [mpp.md](/home/t42/Documents/pirate-v2/specs/api/mpp.md):

- free human and agent discovery should exist
- free bulk extraction should not

## Table Ownership

The strongest sovereignty boundary is Tableland table ownership itself.

Recommended ownership model:

| Governance mode | Table owner | Controller policy posture |
|---|---|---|
| `centralized` | Pirate registry manager contract | Pirate delegate path controls writes |
| `multisig` | Safe | Safe or approved delegate controls writes |
| `majeur` | DAO contract | DAO or approved delegate controls writes |

This means governance transfer is an onchain table-ownership transfer, not an operator promise.

## Required Contract

This design requires a small new contract.

Recommended v0 contract:

- `ClubTableManagerV1`

Responsibilities:

- create Tableland tables for a new club
- store the mapping between club identity and table identity
- hold tables initially for centralized communities
- transfer table ownership on governance upgrade
- optionally serve as an approved delegate writer for product-mediated mutations
- maintain pointers to shared discovery index tables when Pirate owns those indexes

This is narrower than a full onchain club factory.
It is a registry-plane ownership manager, not the canonical creator of all communities.

## Table Identity And Primary Keys

For Tableland rows, use a local integer surrogate key from the start.

Recommended pattern:

- integer auto-increment primary key for Tableland-local addressing and controller efficiency
- `community_id` text as a unique column for canonical product identity

Important:

- `community_id` remains the canonical Pirate product identifier
- the integer key is a Tableland-local row address only
- this does not replace the opaque ID model used everywhere else in the repo

Reasoning:

- Tableland SQL and controller clauses are cleaner with integer row addressing
- adding a surrogate key later is painful
- carrying one extra integer column from the start is cheap

## Controller Model

Recommended write model:

- governance authority owns the table
- Pirate product flows write through an approved delegate path
- governance authority can always revoke or replace that delegate later

This is the preferred v0 posture for governance-backed communities.

Interpretation:

- direct raw-SQL governance actions are possible but not required for normal product UX
- Pirate can still offer normal app flows
- sovereignty is preserved because the constitutional authority still owns the table and controller

## Controller ACL Specification

The controller contract must be specified per canonical table class.

Notation:

- `owner`
  the current ERC-721 table owner
- `delegate`
  `ClubTableManagerV1` or another governance-approved delegate writer
- `platform`
  a Pirate-controlled path used for derived-state publication from Turso workflows

### `club_registry_current`

Purpose:

- public club identity row plus merged one-row public summaries for governance, donation, and handle policy

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `delegate` | yes | yes | no | `display_name`, `description`, `avatar_ref`, `cover_ref` |
| `platform` | no | yes | no | `status`, `governance_mode`, `governance_chain_id`, `governance_contract_address`, `governance_treasury_address`, `observed_owner_set_json`, `observed_owner_set_observed_at`, `governance_verification_state`, `governance_last_verified_at`, `donation_policy_mode`, `donation_partner_status`, `handle_policy_template`, `handle_pricing_model`, `handle_claims_enabled`, `handle_premium_enabled`, `handle_auction_enabled`, `updated_at` |
| anyone else | no | no | no | none |

Important:

- `status` and `governance_mode` are not ordinary club-edit columns
- they are finalized by Pirate after the relevant operational or constitutional action completes
- governance pointer fields, donation publication fields, and handle-policy summary fields are merged into this row to keep the per-community table set small

### `club_reference_links_current`

Purpose:

- public identity-bearing links with derived verification state

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `delegate` | yes | yes | no | `platform`, `url`, `display_label`, `link_status`, `position` |
| `platform` | no | yes | no | `verification_state`, `verified_at`, `last_checked_at`, `updated_at` |
| anyone else | no | no | no | none |

Important:

- proof-derived verification columns are platform-published, not direct club writes

### `club_rules_current`

Purpose:

- public current rules for the club

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `delegate` | yes | yes | no | `title`, `body`, `position`, `rule_status`, `updated_at` |
| anyone else | no | no | no | none |

Important:

- archive, do not hard-delete, in normal product flows

### `club_resource_links_current`

Purpose:

- editorial public links for the club profile

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `delegate` | yes | yes | no | `label`, `url`, `resource_kind`, `position`, `link_status`, `updated_at` |
| anyone else | no | no | no | none |

### `club_namespace_current`

Purpose:

- public derived namespace summary

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `platform` | yes | yes | no | `display_label`, `normalized_label`, `route_family`, `namespace_role`, `status`, `root_proof_status`, `delegation_status`, `last_verified_at`, `updated_at` |
| anyone else | no | no | no | none |

Important:

- namespace registry rows are derived from the richer Turso evidence model
- they are not directly club-authored freeform rows
- no ordinary `delegate` row is provided here because namespace publication is intentionally platform-derived from verification and governance workflows, not a direct club edit surface

### `livestream_public_current`

Purpose:

- public schedule and post-event discovery row

Policy:

| Caller | allowInsert | allowUpdate | allowDelete | Updatable columns |
|---|---|---|---|---|
| `owner` | yes | yes | no | all |
| `delegate` | yes | yes | no | `title`, `description`, `event_start_at`, `access_mode`, `visibility`, `cover_ref`, `updated_at` |
| `platform` | no | yes | no | `status`, `replay_status`, `updated_at` |
| anyone else | no | no | no | none |

Important:

- `status` here is publication status, not real-time liveness

## Write Path

### Centralized club

1. user calls Pirate API
2. Pirate validates permission
3. Pirate submits the mutation through `ClubTableManagerV1`
4. Tableland materializes the mutation
5. Turso cache catches up

### Governance-backed club

Recommended v0:

- same user-facing product flow
- writes still go through Pirate's product path
- `ClubTableManagerV1` acts as an authorized delegate
- the Safe or DAO can replace or revoke that delegate later

This is more usable than requiring the governance contract to author every raw SQL mutation directly.

## Read Path

### External agents

External agents should be able to read Tableland directly for free.

This is the public registry plane.

### Pirate app

Pirate app reads should use a Turso cache or projection of the Tableland registry for performance.

Important:

- the cache is not authoritative
- Tableland remains the public registry truth
- cache divergence resolves in favor of Tableland

Recommended v0 sync posture:

- a Tableland sync worker polls finalized mutation outcomes and refreshes affected rows into Turso
- no validator webhook dependency is assumed in v0
- periodic doctor or reconcile jobs repair drift

### Operational reads

For security-sensitive or latency-sensitive decisions, Pirate reads operational state from Turso.

Examples:

- can this user post
- is this room live right now
- what is the current moderation status

## Event Table Policy

Do not create `_events` tables for everything.

Use them only when semantic history matters beyond generic SQL mutation history.

Good event-table candidates:

- `club_registry_events`
- `club_rules_events`
- `club_governance_events`

Possible but optional:

- `club_namespace_events`

Usually unnecessary:

- link-update events
- livestream schedule events
- donation policy events

The raw Tableland mutation log is already an immutable low-level audit trail.
Use SQL-level event tables only where richer semantic labels such as `name_changed` or `governance_attached` materially help product and governance audit.

Recommended minimal event schemas:

### `club_registry_events`

- `id` integer primary key
- `community_id` text not null
- `event_type` text not null
- `actor_address` text
- `old_value_json` text
- `new_value_json` text
- `reason` text
- `created_at` text not null

### `club_rules_events`

- `id` integer primary key
- `community_id` text not null
- `event_type` text not null
- `actor_address` text
- `summary` text
- `created_at` text not null

### `club_governance_events`

- `id` integer primary key
- `community_id` text not null
- `event_type` text not null
- `actor_address` text
- `old_governance_mode` text
- `new_governance_mode` text
- `old_contract_address` text
- `new_contract_address` text
- `created_at` text not null

## Livestream Status Rule

Tableland's livestream registry status should be a publication status, not the runtime truth.

Recommended mapping:

| Turso runtime state | Tableland public status |
|---|---|
| `scheduled` | `scheduled` |
| `live` | `scheduled` |
| `ended` | `ended` |
| `canceled` | `canceled` |

That means:

- Tableland is the schedule and public event-discovery plane
- Turso or a cache is the real-time liveness plane

## `community_id` Trust Assumption

In v0, Tableland rows referencing `community_id` still rely on Pirate's publisher identity.

This is acceptable if stated clearly:

- Pirate's registry-manager contract is the attestation that a published row belongs to the canonical Pirate club namespace
- external readers trust the publishing contract as the registry authority

No full onchain club registry is required in v0.

If stronger provenance is needed later, Pirate may add:

- commitment rows
- a lightweight onchain club registry
- stronger cross-chain attestations

## Proposed Table Set

Recommended v0 registry tables:

Canonical per-community tables:

- `club_registry_current_<tableId>`
- `club_registry_events_<tableId>`
- `club_namespace_current_<tableId>`
- `club_reference_links_current_<tableId>`
- `club_rules_current_<tableId>`
- `club_rules_events_<tableId>`
- `club_resource_links_current_<tableId>`
- `livestream_public_current_<tableId>`

Shared discovery indexes:

- `clubs_directory_current`
- `livestreams_directory_current`

### `club_registry_current`

Recommended columns:

- `id` integer primary key
- `community_id` text unique not null
- `display_name` text not null
- `description` text
- `avatar_ref` text
- `cover_ref` text
- `status` text not null
- `governance_mode` text not null
- `governance_chain_id` integer
- `governance_contract_address` text
- `governance_treasury_address` text
- `observed_owner_set_json` text
- `observed_owner_set_observed_at` text
- `governance_verification_state` text
- `governance_last_verified_at` text
- `donation_policy_mode` text
- `donation_partner_status` text
- `handle_policy_template` text
- `handle_pricing_model` text
- `handle_claims_enabled` integer not null
- `handle_premium_enabled` integer not null
- `handle_auction_enabled` integer not null
- `updated_at` text not null

### `club_namespace_current_<tableId>`

Recommended columns:

- `id` integer primary key
- `community_id` text not null
- `namespace_id` text not null
- `display_label` text not null
- `normalized_label` text not null
- `route_family` text not null
- `namespace_role` text not null
- `status` text not null
- `root_proof_status` text not null
- `delegation_status` text not null
- `last_verified_at` text
- `updated_at` text not null

### `club_reference_links_current_<tableId>`

Recommended columns:

- `id` integer primary key
- `community_id` text not null
- `platform` text not null
- `url` text not null
- `display_label` text
- `verification_state` text not null
- `verified_at` text
- `last_checked_at` text
- `link_status` text not null
- `position` integer
- `updated_at` text not null

### `club_rules_current_<tableId>`

Recommended columns:

- `id` integer primary key
- `community_id` text not null
- `title` text not null
- `body` text
- `position` integer
- `rule_status` text not null
- `updated_at` text not null

### `club_resource_links_current_<tableId>`

Recommended columns:

- `id` integer primary key
- `community_id` text not null
- `label` text not null
- `url` text not null
- `resource_kind` text
- `position` integer
- `link_status` text not null
- `updated_at` text not null

### `livestream_public_current_<tableId>`

Recommended columns:

- `id` integer primary key
- `live_room_id` text unique not null
- `community_id` text not null
- `title` text not null
- `description` text
- `host_address` text
- `event_start_at` text
- `status` text not null
- `access_mode` text not null
- `visibility` text not null
- `cover_ref` text
- `replay_status` text not null
- `updated_at` text not null

## MPP Boundary

Tableland is for free public registry reads.

MPP is for paid deep machine access.

If millions of agents want to know:

- what communities exist
- what roots they control
- what rules they publish
- which links are verified
- what public events are scheduled

they should read the registry for free.

If they want:

- full post corpus
- full reply trees
- bulk archives
- corpus search
- machine-optimized exports

they should use MPP and pay.

This is the central design boundary.

## Summary

The v0 target posture is:

- Tableland-authoritative for public club registry state
- Turso-authoritative for operational and private state
- MPP-authoritative for paid corpus extraction

This gives Pirate:

- community-owned public identity and configuration
- provable governance-linked table ownership transfer
- good app performance through operational storage and cache layers
- a clean public-registry versus paid-corpus split for agents
