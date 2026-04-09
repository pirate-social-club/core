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
- `references/`

These directories define system behavior, migrations, control-plane operations, shared config, and upstream reference material.

## What Does Not Belong In `core` Long-Term

These production surfaces should not accumulate here as permanent homes:

- Android app code
- iOS app code
- Desktop app code
- Production backend service repos

Those belong in their own repositories under `pirate-social-club`.

## Transitional Roots In This Repo

Two roots currently sit in a transitional state:

- `pirate-web/`
- `pirate-contracts/`

They contain substantial application and protocol code, so they read like real product surfaces rather than lightweight prototypes.

For now they can remain here while work is still tightly coupled to specs, migrations, and control-plane design. But they should be treated as extraction candidates, not permanent `core` structure.

## Target Model

Canonical ownership should eventually look like this:

- `pirate-social-club/core`
  - `specs/`
  - `db/`
  - `config/`
  - `docs/`
  - `scripts/`
  - `lit-actions/`
  - `references/`
- `pirate-social-club/web`
  - production web app
- `pirate-social-club/contracts`
  - production contract workspaces
- `pirate-social-club/api`
  - production backend services
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
3. Specs live in Git and GitHub. They are first-class source material, not throwaway notes.
4. Sensitive operational documents can remain private in `core`.
5. Public-facing runtime repos should implement against `core` specs instead of duplicating them.

## Extraction Criteria

`pirate-web/` or `pirate-contracts/` should be extracted when most of the following become true:

- the code is clearly a production surface
- it has its own review and release cadence
- changes no longer routinely require same-PR edits in `specs/`, `db/`, or `lit-actions/`
- the repo boundary would reduce confusion rather than create version skew

## Recommended Next Extraction Order

1. `pirate-web/` -> `pirate-social-club/web`
2. `pirate-contracts/` -> `pirate-social-club/contracts`

That order keeps `core` focused fastest, because those two roots are the strongest sources of ambiguity today.
