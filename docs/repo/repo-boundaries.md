# Repo Boundaries

This repository is the canonical `pirate/core` repo.

Its purpose is to hold shared system definition and integration work across Pirate surfaces. It is not a runtime repo and should not become a second copy of the GitHub organization.

## What Belongs In `core`

These roots fit the `core` role and should remain here:

- `specs/`
  - `api/`
  - `contracts/`
  - `domain/`
- `db/`
- `config/`
- `docs/`
- `scripts/`
- `lit-actions/`
- `ops/`
- `references/`

These directories define system behavior, migrations, control-plane operations, shared config, deployment assets, and reference material used by active specs or runbooks.

## What Does Not Belong In `core`

These production surfaces belong in standalone repos:

- backend API services
- web UI
- contracts workspace
- Android app
- iOS app
- desktop app
- standalone plugin packages with their own release workflow

## Canonical Local Workspace

Runtime repos live beside `core` in the canonical local workspace:

```text
/home/t42/Documents/pirate-workspace/
  core/
  api/
  web/
  contracts/
  desktop/
  android/
```

They must not be tracked by `core`. They are local checkouts of standalone repos such as `pirate/api`, `pirate/web`, `pirate/contracts`, `pirate/desktop`, and `pirate/android`.

Scripts and active runbooks that need sidecar paths should use checkout variables instead of assuming the repos live under `core`.

Rules for sidecar-aware material:

- scripts that need a runtime checkout must accept a path variable such as `API_DIR`.
- local env examples and operator runbooks must not require sidecar-private `.local` paths.
- markdown links into sidecars should be treated as cross-repo references, not proof that the sidecar must live inside `core`.

## Completed Decoupling

- `scripts/lib/*` no longer imports helpers from runtime repos.
- API contract generation and typechecking can be redirected with `API_CONTRACTS_DIR` or `API_CONTRACTS_OUTPUT_FILE`.
- Wrangler secret sync resolves the sibling `pirate-workspace/api` path, and also accepts `API_DIR` or `--api-dir`.
- Active runbooks use `PIRATE_API_DIR`, `PIRATE_API_REPO`, `PIRATE_WEB_DIR`, or `PIRATE_CORE_REPO` for checkout-specific commands.
- Plugin source has been extracted from tracked `core`.

## Target Ownership

Canonical ownership:

- `pirate/core`: specs, migrations, config, docs, scripts, Lit actions, ops, and references.
- `pirate/api`: production backend services.
- `pirate/web`: web UI and browser runtime.
- `pirate/contracts`: contract workspaces and tests.
- `pirate/android`: production Android app.
- `pirate/ios`: production iOS app.
- `pirate/desktop`: production desktop app.

## Rules Going Forward

1. Make runtime changes in the standalone repos, not in `core`.
2. Keep `core/specs`, `core/docs`, `core/config`, `core/db`, `core/scripts`, `core/lit-actions`, and `core/ops` as the shared source of truth.
3. Keep sibling runtime repos ignored by `core`.
4. Specs live in Git and GitHub. They are first-class source material, not throwaway notes.
5. Sensitive operational documents can remain private in `core`.
