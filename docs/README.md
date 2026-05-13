# Docs Index

`docs/` holds current shared architecture, operations, rollout, and implementation contracts that do not fit cleanly in `specs/` or `db/`.

Use these buckets first:

- `control-plane/`
  Control-plane schema, secrets, Turso provisioning, and Infisical boundary docs.
- `community/`
  Community registry and cross-plane community contracts.
- `operators/`
  Signer families, Spaces, Sentinel, and other operator-facing runtime contracts.
- `product/`
  Current product contracts that cut across runtime repos.
- `repo/`
  Canonical workspace boundaries and target structure for `core`.
- `runbooks/`
  Active operational checklists and smoke procedures.
- `adr/`
  Architecture decisions that should stay stable over time.
- `analytics/`
  Event taxonomy and analytics contracts.

Examples by bucket:

## Control Plane

- `control-plane/control-plane-schema.md`
- `control-plane/turso-provisioning-contract.md`
- `control-plane/turso-secret-contract.md`
- `control-plane/secrets-inventory.md`

## Community

- `community/community-registry-plane.md`

## Operators

- `operators/signer-families.md`
- `operators/community-provision-operator-runtime-contract.md`
- `operators/spaces-verification-runtime-contract.md`
- `operators/sentinel-operator-runtime-contract.md`

## Product

- `product/funds-ledger.md`
- `product/market-context-worker-contract.md`

## Repo

- `repo/repo-boundaries.md`
- `repo/core-target-structure.md`

## Runbooks

- `runbooks/happy-path-matrix.md`
- `runbooks/namespace-verification-smoke.md`
- `runbooks/namespace-verification-production-promotion.md`
- `runbooks/github-actions-infisical-oidc.md`

Hygiene rules:

- If a document defines canonical product or API behavior, prefer `specs/`.
- If a document defines canonical schema or migrations, prefer `db/`.
- If a document is runtime-repo specific, prefer that sidecar repo unless the contract is intentionally shared.
- Remove notes, audits, spikes, and plans once they stop describing the mainline system.
- New docs should land in one of the named buckets above instead of returning to a flat `docs/` top level.
