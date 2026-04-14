# Repo Boundaries

This repository is the canonical `pirate-social-club/core` repo.

Its purpose is to hold shared system definition and integration work across the Pirate Social Club surfaces. It is not intended to become a second copy of the entire GitHub organization.

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

These directories define system behavior, migrations, control-plane operations, shared config, deployment assets, and non-canonical reference material.

## What Does Not Belong In `core` Long-Term

These production surfaces should not accumulate here as permanent homes:

- Android app code
- iOS app code
- Desktop app code
- Production backend service repos

Those belong in their own repositories under `pirate-social-club`.

## Local Workspace Sidecars

Runtime repos may still appear inside this working directory:

- `pirate-api/`
- `pirate-web/`
- `pirate-contracts/`
- `pirate-tui/`
- `pirate-desktop/`

They are not tracked by `core`. They are local sidecar checkouts of the standalone repos:

- `pirate-social-club/web`
- `pirate-social-club/contracts`
- `pirate-social-club/api`
- `pirate-social-club/tui`
- `pirate-social-club/desktop`

This keeps the workspace convenient without turning `core` into a shadow monorepo.

## Target Model

Canonical ownership should eventually look like this:

- `pirate-social-club/core`
  - `specs/`
  - `db/`
  - `config/`
  - `docs/`
  - `scripts/`
  - `lit-actions/`
  - `ops/`
  - `references/`
- `pirate-social-club/web`
  - web UI, Storybook, and future app runtime
- `pirate-social-club/contracts`
  - contract workspaces and tests
- `pirate-social-club/api`
  - production backend services
- `pirate-social-club/tui`
  - terminal client
- `pirate-social-club/android`
  - production Android app
- `pirate-social-club/ios`
  - production iOS app
- `pirate-social-club/desktop`
  - production desktop app

## Rules Going Forward

Use these rules to keep the repo clean:

1. `core` owns system definition, not every runtime.
2. New production app surfaces should not be added as new top-level roots here.
3. `pirate-tui/` should remain a sidecar checkout and should not be reintroduced as tracked `core` runtime code.
4. Specs live in Git and GitHub. They are first-class source material, not throwaway notes.
5. Sensitive operational documents can remain private in `core`.
6. Public-facing runtime repos should implement against `core` specs instead of duplicating them.
7. Operational deployment assets that are part of shared infrastructure belong under `ops/`.

## Extraction Status

The repo boundary is healthy when all of the following are true:

- `pirate-social-club/web` is the canonical home of web code
- `pirate-social-club/contracts` is the canonical home of contract code
- `core` no longer tracks runtime code under `pirate-web/` or `pirate-contracts/`
- `core` no longer tracks runtime code under `pirate-api/`
- `core` no longer tracks runtime code under `pirate-tui/`
- `core` no longer tracks runtime code under `pirate-desktop/`
- any local copies at those paths are treated as workspace checkouts only

## Rules Going Forward

1. Make runtime changes in the standalone repos, not in `core`.
2. Keep `core/specs`, `core/docs`, `core/config`, `core/db`, `core/scripts`, `core/lit-actions`, and `core/ops` as the shared source of truth.
3. If local sidecar repos are checked out inside this workspace, keep them ignored by `core`.
