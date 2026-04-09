# Attestations

Status: draft

Related docs:

- [user.md](./user.md)
- [identity-presentation.md](./identity-presentation.md)
- [community.md](./community.md)
- [post.md](./post.md)

## Purpose

This doc defines Pirate's provider-backed attestation layer.

It covers:

- recognized attestation providers
- provider schema registry
- durable user attestation inventory
- how provider attestations map into qualifier eligibility

It does not cover:

- raw provider SDK integration details
- exact proof formats for every provider
- exact UI copy for verification flows

## Core Principle

Proofs or verifiable credentials held by a wallet are not automatically post qualifiers.

Pirate only exposes a proof-backed qualifier when:

1. Pirate recognizes the provider
2. Pirate recognizes the provider schema or attestation type
3. Pirate verifies the result
4. Pirate maps the verified result to a platform-owned qualifier template
5. the club allows that qualifier

## Provider Registry

Pirate should maintain a platform-owned provider registry rather than hardcoding provider behavior into every consuming surface.

Suggested shape:

- `attestation_provider_id`
- `provider_key`
  - `self`
  - `very`
  - `world`
  - `zkpass`
- `provider_kind`
  - `identity_verification`
  - `provider_attestation`
  - `zk_schema_attestation`
- `status`
  - `active`
  - `disabled`
  - `archived`
- `display_name`
- `metadata_json`

Rules:

- the registry is platform-owned, not community-owned
- communities may allow qualifiers derived from a provider, but communities do not define providers
- adding `zkpass` should be a provider-registry row, not a qualifier-schema rewrite

## Provider Schemas

Some providers expose stable, reusable schemas or attestation definitions.

This is especially important for `zkpass`, where a schema is immutable once created and Pirate must know which schema IDs it trusts.

Suggested shape:

- `provider_schema_id`
- `attestation_provider_id`
- `external_schema_id`
- `schema_key`
- `status`
  - `active`
  - `disabled`
  - `archived`
- `schema_kind`
  - `capability_source`
  - `qualifier_source`
- `normalized_attestation_key`
- `normalized_predicate_json`
- `metadata_json`

Rules:

- Pirate must only accept schema-backed attestations from provider schemas it has explicitly registered
- unrecognized schemas must not silently become qualifiers
- provider schemas are platform-owned mappings from external proof meaning to internal normalized meaning

## User Attestations

Pirate should store durable user attestation rows for provider-backed facts that are broader than the small core `verification_capabilities` read model.

Suggested shape:

- `user_attestation_id`
- `user_id`
- `attestation_provider_id`
- `provider_schema_id` nullable
- `status`
  - `verified`
  - `expired`
  - `revoked`
- `proof_type`
  - example: `unique_human`, `wallet_score`, `gov_id`, `sanctions_clear`
- `mechanism`
  - example: `zk-nullifier`, `palm-nullifier`, `stamps-api-v2`
- `attestation_key`
- `attestation_value_json`
- `verified_at`
- `expires_at` nullable
- `revoked_at` nullable
- `proof_ref`
- `evidence_ref` nullable
- `created_at`
- `updated_at`

Rules:

- `user_attestations` are the durable provider-backed source layer
- `user_attestations` should be modeled as a separate relation keyed by `user_id`, not as an inline JSON field on the canonical user row
- not every attestation needs to become a first-class product capability
- `verification_capabilities` in [user.md](./user.md) may remain the small provider-neutral read model for stable core identity primitives such as `unique_human`, `age_over_18`, `nationality`, and `gender`
- qualifier eligibility may read from `verification_capabilities`, `user_attestations`, or both depending on the qualifier template

## Qualifier Mapping

Qualifier templates in [identity-presentation.md](./identity-presentation.md) should map to recognized provider-backed data, not raw wallet contents.

That means a qualifier template may point to:

- a capability in `verification_capabilities`
- or a provider-backed attestation in `user_attestations`

Examples:

- `qlf_age_over_18`
  - source: `verification_capabilities.age_over_18`
- `qlf_very_palm_scan`
  - source: `user_attestations.attestation_key = palm_scan`
- `qlf_zkpass_uber_rides_100_plus`
  - source: `user_attestations.provider_schema_id = <registered zkpass schema>`

Rules:

- qualifier templates are platform-owned
- communities may whitelist qualifier templates, but may not create arbitrary new ones
- users may only attach qualifiers they currently satisfy

## zkPass Example

Recommended zkPass flow:

1. Pirate registers a `zkpass` provider
2. Pirate registers a trusted `provider_schema` for a specific zkPass schema ID
3. user completes the zkPass flow and Pirate verifies the result
4. Pirate stores a normalized `user_attestation`
5. Pirate maps that attestation to a platform qualifier template
6. club may allow that qualifier
7. an eligible user may attach that qualifier to an anonymous post

Example:

- external proof meaning: `Uber rides >= 100`
- normalized attestation: `attestation_key = uber_rides_100_plus`
- qualifier template: `qlf_zkpass_uber_rides_100_plus`
- display label: `100+ Uber Rides`

## Non-Goals

The attestation layer must not:

- expose arbitrary wallet-held credentials directly in the composer
- let communities invent arbitrary qualifier taxonomies
- treat every recognized attestation as automatically displayable

Pirate should curate the small set of qualifier templates it is willing to expose publicly.
