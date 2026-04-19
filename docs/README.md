# Docs Index

`docs/` is the canonical home for shared architecture, operations, rollout notes, and implementation contracts that do not fit cleanly into `specs/` or `db/`.

Use these buckets first:

- `control-plane/`
  Control-plane schema, secrets, Turso provisioning, and Infisical boundary docs.
- `community/`
  Community creation, registry, authority, and cross-plane rollout docs.
- `operators/`
  Signer families, Spaces, Sentinel, and other operator-facing runtime contracts.
- `product/`
  Cross-cutting product, rollout, audit, and flow docs.
- `repo/`
  Repo boundaries, extraction plans, and target structure for `core`.
- `adr/`
  Architecture decisions that should stay stable over time.
- `ci/`
  CI definitions and supporting notes for sidecar repos. These are planning artifacts, not executable workflows. Once a child repo has a real `.github/workflows/*.yml`, the corresponding file here is historical only.
- `tui/`
  TUI-specific contracts and active refactor notes.
- `ux/`
  UI handoff notes that support a runtime surface but are still useful as shared system context.

Examples by bucket:

## Control Plane

- `control-plane/control-plane-schema.md`
- `control-plane/turso-provisioning-contract.md`
- `control-plane/turso-secret-contract.md`
- `control-plane/secrets-inventory.md`

## Community

- `community/community-registry-plane.md`
- `community/executable-community-slice-implementation-plan.md`

## Operators

- `operators/signer-families.md`
- `operators/community-provision-operator-runtime-contract.md`
- `operators/spaces-verification-runtime-contract.md`
- `operators/sentinel-operator-runtime-contract.md`

## Product

- `product/account-creation-first-slice.md`
- `product/auth-session-exchange-transaction-shape.md`
- `product/funds-ledger.md`
- `product/song-publish-v2-audit.md`

## Repo

- `repo/repo-boundaries.md`
- `repo/core-target-structure.md`
- `repo/extraction-plan-tui.md`
- `repo/desktop-electron-architecture-plan.md`

Hygiene rules:

- If a document defines canonical product or API behavior, prefer `specs/`.
- If a document defines canonical schema or migrations, prefer `db/`.
- If a document is runtime-repo specific, prefer that sidecar repo unless the contract is intentionally shared.
- New docs should land in one of the named buckets above instead of returning to a flat `docs/` top level.
