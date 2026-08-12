# Provider-keyed identity evidence

Status: design contract; implementation pending

Related docs:

- [user.md](./user.md)
- [attestations.md](./attestations.md)
- [community-gate-builder.md](./community-gate-builder.md)
- [reward-nationality-nullifier-binding.md](./reward-nationality-nullifier-binding.md)

## Purpose

Identity authorization must read durable evidence keyed by provider. The compact
`verification_capabilities` object remains a client-facing summary, but it must
not decide community-gate, reward-eligibility, or payout authorization after
this migration.

This contract covers the shared read semantics, database invariants, and
transition plan. It does not change proof-verification adapters or authorize a
new provider.

## Existing invariants and precedents

- `identity_nullifiers` already prevents one active provider identity from
  belonging to multiple users. Migration `0059` has a partial unique index on
  `(provider, mechanism, nullifier_hash) WHERE status = 'active'`.
- nationality attestations may reference their exact source nullifier through
  the migration `0178` foreign key. Historical rows were deliberately not
  backfilled.
- `reward_identity_bindings` in migration `0179` is the lifecycle precedent:
  a partial unique index selects the canonical active row and a CHECK couples
  status to its transition timestamp.
- provider and mechanism vocabularies are still PostgreSQL CHECK constraints.
  Migration `0103` had to replace both checks to admit ZKPassport. Until a
  provider registry replaces those checks, every provider addition has this
  schema-migration cost.

The remaining database gaps are narrower: canonical active
`user_attestations` per provider/capability and compare-and-set verification
session finalization. Nullifier uniqueness must be preserved, not rebuilt.

## Authoritative evidence record

The shared reader returns normalized records, not a boolean:

```ts
type IdentityEvidence = {
  evidenceId: string
  userId: string
  capability: "unique_human" | "age_over_18" | "minimum_age" | "nationality" | "gender" | "wallet_score"
  provider: string
  mechanism: string
  value: unknown
  verifiedAt: string
  expiresAt: string | null
  sourceVerificationSessionId: string | null
  sourceIdentityNullifierId: string | null
}

type EvidenceAtomEvaluation = {
  outcome: "passed" | "action_required" | "terminal_mismatch" | "provider_unavailable"
  witnesses: IdentityEvidence[]
  missingCapabilities: string[]
  mismatchReasons: string[]
}
```

The concrete API may use narrower generics or discriminated values. The hard
requirements are that callers receive the matching evidence witnesses and
that provider, lifecycle, and value comparison happen inside the shared
evaluator. Callers must not fetch records and reimplement nationality, gender,
or age comparison themselves.

Only a redacted trace may cross a public API boundary. Evidence identifiers,
nullifier references, and sensitive values remain server-side unless a
separate disclosure contract explicitly permits them.

## Active evidence

An evidence row is eligible only when all applicable conditions hold:

1. `user_attestations.status = 'accepted'`;
2. `verified_at` is present and not in the future;
3. `expires_at` is null or later than the evaluation time;
4. the row is not revoked or superseded;
5. its provider and mechanism are registered for the capability;
6. personhood and document evidence that requires a nullifier is bound to an
   active, provider-compatible nullifier owned by the same user.

The evaluator receives one authoritative evaluation timestamp so every atom
in a policy observes the same expiry boundary.

## Multiple providers and conflicting values

`accepted_providers` is a set of alternatives. It does not mean that every
listed provider must agree.

The rule is **single-record any-match per atom**:

- one atom passes when at least one active record from an accepted provider
  independently satisfies every value predicate on that atom;
- provider acceptance from one record and a value from another may never be
  combined into a synthetic witness;
- conflicting records from other accepted providers neither overwrite nor
  veto the witness;
- separate atoms in an AND expression may use separate evidence records;
- requiring several facts from the same verification session or document is a
  future explicit binding feature, not an implicit side effect of array order
  or a one-slot projection.

This deliberately preserves the meaning of accepted providers as alternatives.
A community that does not want provider choice can pin the atom to one
provider. A user with two genuinely valid nationalities may satisfy positive
allowlist atoms with either document; the evaluator does not invent one global
"true nationality."

Nationality exclusion is not proof that a person lacks another nationality.
Under any-match semantics, an excluded value cannot witness the atom, while a
different accepted record may. Product copy must describe this only as a
presented verified-nationality condition. Sanctions or negative-jurisdiction
claims require a dedicated `sanctions_clear` capability and must not be
implemented by treating a nationality exclusion as proof of absence.

Legacy document atoms without `accepted_providers` continue to mean
`["self"]`. This migration does not broaden them. Any policy backfill that
adds ZKPassport is a separate reviewed product operation.

## Attestation lifecycle constraints

The migration should follow the `reward_identity_bindings` idiom:

- add an explicit `superseded_at` timestamp if supersession remains a distinct
  status;
- add a CHECK that couples `accepted`, `expired`, `revoked`, and `superseded`
  statuses to their required timestamps;
- allow at most one canonical `accepted` row for
  `(user_id, capability_key, provider)` with a partial unique index;
- allow at most one row for
  `(source_verification_session_id, capability_key, provider)` when the source
  session is present, making finalization idempotent at the database boundary;
- supersede the prior accepted row before inserting its replacement in the
  same transaction;
- update `verification_capabilities` last as a derived projection.

Expiry cannot be expressed as `expires_at > now()` in a partial unique index.
The lifecycle must transition an expired accepted row to `expired` before a
replacement becomes canonical.

Before adding constraints, a read-only production audit must classify duplicate
active groups by `(user_id, capability_key, provider)`, distinguish equal from
conflicting values, and report missing, inactive, or provider-incompatible
nullifier links. No row may be deleted or arbitrarily selected by the schema
migration.

## Verification-session compare-and-set

Finalization owns the transition from a non-terminal session to `verified`.
Inside one transaction it must:

1. claim the session with an UPDATE whose WHERE clause names the allowed
   non-terminal status and whose affected-row count is exactly one;
2. write or supersede attestations and bind required nullifiers;
3. update the derived capability projection;
4. commit the terminal session result.

A concurrent loser rereads the committed terminal result and returns it
idempotently. It must not insert a second attestation set. Provider failure and
expiry transitions use the same compare-and-set discipline.

## Shared authorization evaluator

Community gates, reward campaign eligibility, reward identity selection, and
cashout must depend on one evidence evaluator. Policy-specific code supplies
the atom and accepted providers; it does not define evidence validity.

The evaluator owns:

- provider and mechanism compatibility;
- active/expired/revoked/superseded state;
- nullifier ownership and status;
- country-code normalization and allow/exclude comparison;
- gender-marker comparison;
- minimum-age thresholds;
- witness selection and redacted mismatch reasons.

The `verification_capabilities` projection may still power account summaries,
provider suggestions, and non-authoritative UI. Authorization callers may use
it only as a cache when the result is proven equivalent to the evidence read;
the durable records remain authoritative.

## Interim authoring guard

Until this reader ships, strict gate-policy writes reject a policy that
necessarily requires the same provider-backed identity capability more than
once through an AND path. OR alternatives remain legal, including
`unique_human` from Self OR ZKPassport.

Stored policies remain readable so adding the guard does not turn an existing
bad policy into a community-read outage. The guard is temporary and should be
removed when provider-keyed evidence makes multi-provider conjunctions
satisfiable and diagnosable.

## Data and rollout sequence

1. Run and review the production control-plane audit. Gate policies are
   sharded per community and are not part of this control-plane query.
2. Reconcile duplicate or unbound evidence through an independently reviewed
   job or require re-verification; never guess ambiguous provenance.
3. Add lifecycle constraints and verification-session compare-and-set.
4. Introduce the shared reader and evaluator behind shadow comparisons.
5. Convert community gates, reward eligibility, reward identity selection, and
   cashout as one authorization-semantic change.
6. Remove the temporary duplicate-capability authoring guard.
7. Stop authorization reads from the one-slot capability projection.
8. Add the provider registry before the next provider ships, replacing CHECK
   swaps and hardcoded validation vocabularies without moving proof adapters
   out of code.

Required parity coverage includes every supported provider, expiry, revocation,
supersession, provider mismatch, conflicting values, multiple simultaneous
providers, legacy Self-only atoms, concurrent finalization, and repeated
idempotent completion.
