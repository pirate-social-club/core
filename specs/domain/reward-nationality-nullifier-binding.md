# Reward nationality nullifier binding

Related design: [provider-keyed-identity-evidence.md](./provider-keyed-identity-evidence.md)

## Invariant

Nationality evidence used by rewards must reference the exact active identity
nullifier that defines the claimant's reward identity. The account-level
`verification_capabilities_json.nationality` projection is never authoritative
for reward eligibility or payout decisions.

## Slice 1 scope

For newly completed Self verifications, the control-plane transaction writes in
this order:

1. the `unique_human` attestation;
2. a new identity nullifier, when one does not already exist;
3. the nationality attestation referencing that nullifier;
4. the account capability projection.

The graph is acyclic: the nullifier references the unique-human attestation,
while the nationality attestation references the nullifier. IDs are generated
before the batch and every foreign-key parent is inserted before its child. The
ordering works for production Postgres through Hyperdrive and for the
non-Postgres development/test control-plane path without deferred constraints.

When the active nullifier already exists, the nationality attestation references
that row even though a re-verification has a newer verification-session ID. If a
concurrent completion wins the nullifier insert race, the loser handles only the
expected active-nullifier uniqueness violation, resolves the winning row, and
replays once through the reuse path. Other failures are not retried.

## Rejected alternatives

- A post-transaction binding repair creates a successful-but-unbound window and
  is not permitted.
- Copying the provider/mechanism/nullifier tuple onto the nationality attestation
  would discard referential integrity and is not permitted.
- Existing account-level nationality values are not backfilled by the schema
  migration.

## Existing evidence classification (future slice)

Existing attestations will later be reported, not guessed, in four buckets:

- **exact:** the attestation session matches one compatible nullifier session;
- **probable:** no session match and exactly one active nullifier exists for the
  same user and provider;
- **ambiguous:** multiple compatible active nullifiers exist;
- **invalid:** providers differ or no compatible provider evidence exists.

Only an independently reviewed data job may bind the exact bucket. The other
buckets require re-verification or explicit document selection.

## Primary live threat

Self and ZKPassport both project nationality into one account slot. ZKPassport
may therefore replace the displayed account nationality while the reward
identity remains a Self nullifier that disclosed no nationality. Nullifier-bound
attestations prevent that cross-provider projection overwrite from becoming
reward evidence.

## Non-goals

This slice does not classify or backfill existing evidence, select a reward
document, change reward identity resolution, add provider capabilities, evaluate
claims, fund tiered campaigns, reserve contribution lots, or move money.
