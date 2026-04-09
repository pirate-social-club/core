# Namespace Root Control

Status: draft

Related docs:

- [namespace.md](./namespace.md)
- [handles.md](./handles.md)
- [community.md](./community.md)

## Purpose

This doc defines the audit-oriented control model for attaching external roots to Pirate communities.

It covers:

- protocol-specific evidence collection for HNS and Spaces
- derived product capabilities
- downgrade behavior when evidence drifts or becomes contradictory
- the transition table Pirate should apply when root state changes

## Core Model

Pirate should model namespace root integrations as:

- evidence
- assertions
- capabilities

Do not collapse those into one monolithic `verified` state.

Definitions:

- `evidence`
  Raw observed or verified facts such as a TXT challenge response, a Merkle proof, a signature, or an authoritative delegation snapshot.
- `assertions`
  Derived claims Pirate accepts from that evidence, such as "the user currently controls this root" or "Pirate currently has DNS authority for subdomain lifecycle."
- `capabilities`
  Product permissions unlocked by accepted assertions, such as attaching the club root or issuing Pirate-managed subhandles.

## Audit Objects

Pirate should persist at least:

- `evidence_bundle`
  - immutable raw proof material
  - protocol family
  - normalized root
  - verifier or resolver version
  - observation timestamp
  - evidence hash
- `assertion_record`
  - assertion name
  - derived value
  - source evidence bundle refs
  - first accepted at
  - last revalidated at
  - stale or disputed marker if applicable
- `revalidation_event`
  - trigger
  - old evidence summary
  - new evidence summary
  - old capability set
  - new capability set
  - resulting user-facing state

## Creator Eligibility Precondition

Namespace root attachment is not only a root-proof problem. It also depends on creator identity policy.

Recommended v0 default:

- `creator_unique_human_verified = true` only when `verification_capabilities.unique_human.state = verified` from an accepted biometric/nullifier provider such as `self` or `very`
- root-attached community creation should require `creator_unique_human_verified = true`
- wallet-score systems such as Human Passport may support softer anti-Sybil gating elsewhere, but should not be the sole creator proof for root-attached community creation in v0

See [community.md](./community.md) for community-creation policy and [user.md](./user.md) for provider and proof semantics.

## HNS Evidence

Recommended HNS evidence flags:

- `root_exists`
- `root_control_verified`
- `expiry_horizon_sufficient`
- `routing_enabled`
- `pirate_dns_authority_verified`

Use `root_control_verified`, not `ownership_verified`.

Rationale:

- a TXT nonce challenge proves current operational control over the root's DNS behavior
- root expiry or renewal horizon determines whether Pirate should trust the root as a viable community namespace rather than a near-expiry asset
- edge routing proves traffic can reach Pirate
- authoritative NS or equivalent delegation proves Pirate can safely manage subdomain lifecycle

Those are different facts and must remain separate.

## HNS Expiry Horizon

Pirate should inspect the HNS root's remaining lifetime during root verification.

Recommended v0 rule:

- `expiry_horizon_sufficient = true` only when the root has more than 90 days remaining before expiry at the time Pirate accepts the root for community creation

Recommended product behavior:

- if remaining lifetime is `<= 90 days`, Pirate should block new primary community creation on that root
- if the root is already attached and later falls below the horizon, Pirate should not delete the club, but should mark the namespace riskier and disable new paid namespace sales until the expiry horizon is restored
- mirror attachment may follow the same rule in v0 for simplicity rather than introducing a special-case exception

Rationale:

- near-expiry roots are materially higher rug and abandonment risk
- this is a cheap, legible precondition compared with trying to infer future renewal intent
- a three-month floor is long enough to avoid obviously fragile launches while short enough not to block normal holders

The exact chain query or resolver API used to derive the expiry should be treated as implementation detail.

Pirate should persist:

- observed expiry height or timestamp if the protocol exposes it
- the derived remaining-lifetime value at verification time
- the verification source and timestamp

## Resolver Policy

Resolver transport is an implementation concern, not a product capability.

Recommended v0 posture:

- Pirate may use HNS-aware recursive resolvers, binary DoH endpoints, JSON DNS APIs, or self-hosted HNS infrastructure to inspect roots and verify TXT challenges
- Pirate may use one trusted public HNS API provider as the primary observation source for public v0 verification
- Fire HSD is acceptable as that provider for launch
- Pirate should record the provider, observation timestamp, and raw response snapshot or equivalent evidence reference in the `evidence_bundle`
- if the trusted provider is unavailable or returns inconsistent data for the requested root, verification should fail closed and require the user to retry later
- multi-source cross-checking or self-hosted HNS infrastructure is a recommended hardening path after launch, not a public-v0 requirement
- the resolver path should be recorded in the `evidence_bundle`

Important:

- DoH is acceptable as a transport for HNS-aware inspection
- a public HNS API or DoH endpoint is an operational dependency, not a cryptographic trust guarantee
- the lack of publicly trusted TLS certificates for HNS roots is separate from Pirate's proof model and should not change the requirement to verify control and delegation through recorded evidence

## HNS Capabilities

Derived HNS capabilities:

- `club_attach_allowed = creator_unique_human_verified && root_control_verified && expiry_horizon_sufficient`
- `pirate_web_routing_allowed = root_control_verified && routing_enabled`
- `pirate_subdomain_issuance_allowed = root_control_verified && expiry_horizon_sufficient && pirate_dns_authority_verified`

Important:

- `pirate_subdomain_issuance_allowed` must never turn on from edge routing alone
- wildcard or edge-only pointing is not enough to claim Pirate is authoritative for `alice.<tld>` lifecycle
- `pirate_subdomain_issuance_allowed` is a technical namespace capability, not automatic product permission to sell or claim subdomains
- public handle commerce may additionally require the club's derived community-stage capabilities and stronger governance posture for priced inventory

## Spaces Evidence

Recommended Spaces evidence flags:

- `root_key_proof_verified`
- `live_signature_verified`
- `owner_signed_updates_verified`

Do not introduce a Pirate-managed subordinate issuance evidence flag in v0.

Rationale:

- Spaces provides a stronger root proof path through trust anchors, Merkle proofs, and message signatures
- the subordinate issuance and certificate surface is still conservative territory for Pirate product commitments

No HNS-style expiry-horizon gate is defined for Spaces in v0.

Rationale:

- Spaces freshness should be modeled through anchor freshness, proof validity, and live control verification
- this avoids implying that Spaces roots have the same lease-expiry semantics as HNS roots

## Spaces Capabilities

Derived Spaces capabilities:

- `club_attach_allowed = creator_unique_human_verified && root_key_proof_verified && live_signature_verified`
- `owner_signed_record_updates_allowed = club_attach_allowed && owner_signed_updates_verified`
- `pirate_subspace_issuance_allowed = false`

Pirate should support root attachment first and remain conservative on subordinate issuance until the certificate, revocation, and delegation model is explicitly specified.

## Trust Classes

Pirate should expose a separate trust and risk label derived from external control posture.

Recommended v0 control classes:

- `single_holder_root`
- `multisig_controlled_root`
- `dao_controlled_root`
- `burned_or_immutable_root`

Recommended v0 namespace operation classes:

- `owner_managed_namespace`
- `routing_only_namespace`
- `pirate_delegated_namespace`
- `owner_signed_updates_namespace`

Important:

- these trust classes are separate from root proof and separate from handle-issuance capabilities
- a club with a valid root proof may still be high-risk if it is attached to a single-holder root
- a `single_holder_root` may still be acceptable for club attachment and routing at launch, while public handle sales remain disabled until stronger control posture is established
- UI should surface the control class and operation class independently from the verification checklist

## User-Facing State

User-facing state should be composed from evidence and capabilities, not from one generic verification badge.

Recommended copy atoms:

- `Expiry horizon sufficient`
- `Root control verified`
- `Routing enabled`
- `Pirate DNS authority verified`
- `Pirate subdomain issuance enabled`
- `Root key proof verified`
- `Live signature verified`
- `Owner-signed updates enabled`
- `Stale`
- `Disputed`

Each label should map to one evidence fact or one capability, never both.

## Transition Table

### HNS

| Event | Evidence Change | Capability Change | User-Facing State |
| --- | --- | --- | --- |
| Root inspection succeeds and name exists | `root_exists = true` | none | root found |
| Expiry check shows more than 90 days remaining | `expiry_horizon_sufficient = true` | none until root control is also verified | Expiry horizon sufficient |
| TXT challenge verified | `root_control_verified = true` | `community_attach_allowed = true` if expiry horizon is also sufficient | Root control verified |
| Edge or wildcard routing detected | `routing_enabled = true` | `pirate_web_routing_allowed = true` if root control already verified | Routing enabled |
| Authoritative NS or equivalent Pirate DNS delegation verified | `pirate_dns_authority_verified = true` | `pirate_subdomain_issuance_allowed = true` if root control and expiry horizon are already verified | Pirate DNS authority verified; Pirate subdomain issuance enabled |
| Expiry falls to 90 days or less | `expiry_horizon_sufficient = false` | `community_attach_allowed = false`; `pirate_subdomain_issuance_allowed = false` | near expiry |
| Routing removed but control proof still valid | `routing_enabled = false` | `pirate_web_routing_allowed = false` | routing disabled |
| Delegation removed but control proof still valid | `pirate_dns_authority_verified = false` | `pirate_subdomain_issuance_allowed = false` | Pirate subdomain issuance disabled |
| Control proof becomes stale without contradiction | no flag forced false; mark assertion stale | no automatic club detach | Stale |
| Contradictory proof or hostile takeover evidence appears | `root_control_verified = false` or disputed assertion | disable all HNS capabilities derived from root control | Disputed |

### Spaces

| Event | Evidence Change | Capability Change | User-Facing State |
| --- | --- | --- | --- |
| Root proof verified against accepted anchor | `root_key_proof_verified = true` | none until live control also verified | Root key proof verified |
| Pirate challenge signed by proven key | `live_signature_verified = true` | `community_attach_allowed = true` if root key proof already verified | Live signature verified |
| Owner-signed record update path explicitly enabled and verified | `owner_signed_updates_verified = true` | `owner_signed_record_updates_allowed = true` if community attach already allowed | Owner-signed updates enabled |
| Anchor freshness window exceeded without contradictory evidence | no flag forced false; mark assertion stale | no automatic club detach | Stale |
| Fresh contradictory proof accepted | mark proof assertion disputed | disable attach-derived capabilities that rely on the contradicted proof | Disputed |
| Owner-signed update path withdrawn | `owner_signed_updates_verified = false` | `owner_signed_record_updates_allowed = false` | owner-signed updates disabled |

## Failure Handling

Failure handling should be narrow and proportional:

- an HNS root falling below the minimum expiry horizon disables new root-attached monetization and new attach-derived capabilities, but should not auto-delete the club
- losing HNS delegation disables new Pirate-managed subdomain issuance only
- losing HNS routing disables Pirate-hosted root routing only
- losing fresh HNS control proof should mark the root stale or disputed, not auto-delete the club
- stale Spaces anchors or proof freshness should mark the root stale
- contradictory Spaces proof should mark the root disputed

Club history and internal identity should survive these degradations unless a later product policy explicitly says otherwise.

## Implementation Guidance

Recommended implementation order:

1. HNS root inspection
2. HNS expiry-horizon check
3. HNS TXT-based root control proof
4. HNS delegation classification
5. Spaces root proof verification
6. Spaces live signature verification
7. Spaces owner-signed updates
8. Pirate-managed Spaces subordinate issuance only after a separate explicit spec

## Create-Community Handoff

Community creation must not accept raw namespace labels as implicit proof of root control. The create-community API must depend on previously accepted namespace evidence, not on client-entered namespace fields alone.

Recommended v0 handoff model:

- before a user can create a club on a given root, Pirate must have accepted a namespace verification session for that root
- the verification session produces an `evidence_bundle` and derived `assertion_record` set as defined in the Audit Objects section above
- the create-community request references this accepted verification by a server-trusted identifier, not by raw label fields
- the server must reject creation if the referenced verification session is stale, disputed, or does not satisfy `community_attach_allowed` for the relevant protocol family at the time the create request is processed

Suggested v0 reference mechanism:

- `namespace_verification_id` — an opaque server-issued identifier for the accepted namespace verification session
- this identifier is returned by the namespace verification flow and submitted with the create-community request
- the server resolves this identifier to the underlying evidence and assertions at create time
- if the underlying evidence has degraded (stale, disputed, expired), the create request must be rejected

This ensures that `POST /communities` never relies on unverified client-submitted namespace labels as proof of root control. The `NamespaceAttachmentInput` in the API carries the reference, and the server validates the referenced evidence authoritatively.

Rules:

- `namespace_verification_id` must be required on `POST /communities` in v0
- the referenced verification must satisfy `community_attach_allowed` for the relevant protocol family at create time
- the referenced verification must belong to the requesting creator
- if no valid verification session exists, the create request must be rejected before any club state is created
- label fields on `NamespaceAttachmentInput` remain for display and routing purposes, but they are not evidence

## Non-goals

This doc does not define:

- exact HNS record payloads
- exact Spaces certificate or subordinate issuance formats
- the full resolver infrastructure topology
- the full club create API
