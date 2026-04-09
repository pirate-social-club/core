# Core Target Structure

This document defines the target steady-state structure for `pirate-social-club/core`.

## Goal

`core` should be the system-definition and integration repo, not a parallel copy of the entire GitHub organization.

## Keep As Top-Level Roots

These roots belong in `core`:

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

## Transitional Roots

These roots are allowed temporarily but should not be treated as permanent:

- `pirate-web/`
- `pirate-contracts/`

They are current implementation surfaces, not pure system-definition material.

## Avoid Adding

Do not add new top-level roots in `core` for:

- `android/`
- `ios/`
- `desktop/`
- `api/`

Those belong in their own repos under `pirate-social-club`.

## Long-Term Shape

The intended long-term top level for `core` is:

```text
core/
  config/
  db/
  docs/
  lit-actions/
  references/
  scripts/
  specs/
```

At that point, runnable product surfaces should live in their own repos and consume `core` artifacts rather than residing here.
