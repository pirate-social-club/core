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

- `api-next` backend/API services
- `pirate-web-solid` frontend, browser, and Worker runtime
- contracts workspace
- Android app
- iOS app
- desktop app
- standalone plugin packages with their own release workflow

## Canonical Local Workspace

Runtime repos live beside `core` in the canonical local workspace:

```text
/media/t42/codedrive/Code/pirate-workspace/
  core/
  api-next/
  pirate-web-solid/
```

They must not be tracked by `core`. They are independent local checkouts of
standalone repositories. The legacy API and React application are historical
references and must not become runtime dependencies of the clean-break target.

Scripts and active runbooks that need sidecar paths should use checkout variables instead of assuming the repos live under `core`.

Rules for sidecar-aware material:

- scripts that need a runtime checkout must accept a path variable such as `API_DIR`.
- local env examples and operator runbooks must not require sidecar-private `.local` paths.
- markdown links into sidecars should be treated as cross-repo references, not proof that the sidecar must live inside `core`.

## Completed Decoupling

- `scripts/lib/*` no longer imports helpers from runtime repos.
- API contract generation and typechecking can be redirected with `API_CONTRACTS_DIR` or `API_CONTRACTS_OUTPUT_FILE`.
- Wrangler secret sync accepts an explicit API checkout through `API_DIR` or
  `--api-dir`; current target API work uses `api-next`.
- Active runbooks use `PIRATE_API_DIR`, `PIRATE_API_REPO`, `PIRATE_WEB_DIR`, or `PIRATE_CORE_REPO` for checkout-specific commands.
- Plugin source has been extracted from tracked `core`.

## Target Ownership

Canonical ownership:

- `pirate/core`: specs, migrations, config, docs, scripts, Lit actions, ops, and references.
- `api-next`: current production backend services and API contracts.
- `pirate-web-solid`: current frontend, browser, and Worker runtime.
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
