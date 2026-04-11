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
- `ops/`
- `references/`

## Local Sidecars

These roots may exist locally for convenience, but they are not part of tracked `core` state:

- `pirate-api/`
- `pirate-web/`
- `pirate-contracts/`
- `pirate-tui/`

They are sidecar checkouts of the standalone runtime repos.

## Avoid Adding

Do not add new top-level roots in `core` for:

- `android/`
- `ios/`
- `desktop/`
- `api/`
- `tui/`

Those belong in their own repos under `pirate-social-club`.

## Long-Term Shape

The intended long-term top level for `core` is:

```text
core/
  config/
  db/
  docs/
  lit-actions/
  ops/
  references/
  scripts/
  specs/
```

At that point, runnable product surfaces live in their own repos and consume `core` artifacts rather than residing here.
