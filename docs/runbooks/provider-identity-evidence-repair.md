# Provider identity evidence reconciliation

This is a reviewed, reversible repair for the small pre-constraint
`user_attestations` cleanup. It is not a migration and it does not update
`users.verification_capabilities_json`.

## Required sequence

1. Run the aggregate, read-only audit and save its JSON output as the
   before-state.
2. Run the repair command in its default dry-run mode. Review the complete-row
   snapshot and plan before approving execution.
3. Run the same command with `--execute` and the reviewed decision reference.
4. Run the aggregate audit again. Do not add the uniqueness constraint unless
   duplicate active groups, unbound active rows, stale accepted rows, and
   invalid nullifier links are all zero.

The command locks its target rows, writes the snapshot before changing any
row, and applies all transitions in one transaction. It refuses to overwrite
an existing snapshot for a different decision reference and is idempotent after
the first successful execution.

## Semantics

- A duplicate group keeps the row with a valid nullifier link. If none is
  linked, it keeps the earliest verified row as the temporary duplicate winner.
- Every active `unique_human` row without a source nullifier is superseded with
  `value_json` state `{ "state": "superseded", "reason":
  "provenance_unbound", "ref": "<decision-ref>" }`.
- Accepted rows whose `expires_at` has passed transition to `expired`.
- No `revoked_at` is written for supersession.
- No projection or user row is updated.

Conflicting duplicate values and invalid or mismatched nullifier links fail
closed for human review. Historical unbound rows are never assigned invented
nullifier links, consistent with migration 0178.

## Invocation

```bash
rtk bun scripts/control-plane/audit-provider-identity-evidence.ts \
  --database-url-env CONTROL_PLANE_DATABASE_URL \
  > /tmp/provider-identity-evidence-before.json

rtk bun scripts/control-plane/provider-identity-evidence-repair.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --audit-before-file /tmp/provider-identity-evidence-before.json \
  --snapshot-file /tmp/provider-identity-evidence-repair-snapshot.json \
  --decision-ref <review-reference>

rtk bun scripts/control-plane/provider-identity-evidence-repair.ts \
  --database-url-env CONTROL_PLANE_MIGRATOR_DATABASE_URL \
  --audit-before-file /tmp/provider-identity-evidence-before.json \
  --snapshot-file /tmp/provider-identity-evidence-repair-snapshot.json \
  --decision-ref <review-reference> \
  --execute \
  --confirm-repair provider-identity-evidence
```

Production execution must use the reviewed Web production OIDC workflow and
never a raw runtime connection or direct `psql`/D1 write. The checked-in
`web/.github/workflows/provider-identity-evidence-repair.yml` is the supported
workflow: dispatch it from Web `main`, use the existing Web production identity
authorized for `prod:/services/api`, run `dry-run`, review the uploaded snapshot,
and dispatch `execute` with the same decision reference. It always runs a
post-state audit, asserts the accepted-row constraint counts are clean, and
uploads the before, after, and full-row snapshot artifacts.

## Production reconciliation outcome

Decision reference `provider-identity-reconciliation-20260813` executed through
the Web production OIDC workflow on 2026-08-13. The transaction superseded two
unbound Self `unique_human` attestations and expired eight accepted-but-stale
rows. The two superseded rows were the duplicate group for one user, so the
active durable-evidence population changed from three rows across two users to
one linked row for one user. The derived user projection was intentionally left
untouched; the affected user will need to re-verify when authorization moves to
durable evidence.

The post-audit retains the two superseded historical rows as a duplicate
verification-session group. That audit is status-aware, and the session
idempotency constraint is therefore a partial unique index on
`status = 'accepted'`, matching the canonical evidence index.
