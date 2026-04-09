# Web And Contracts Split Record

This document records the completed split of `web` and `contracts` out of `pirate-social-club/core`.

## Result

- `pirate-social-club/web` is the canonical web repo
- `pirate-social-club/contracts` is the canonical contracts repo
- `core` no longer tracks `pirate-web/` or `pirate-contracts/`
- local checkouts at those paths are workspace sidecars only

## How The Split Was Done

1. Fresh standalone repos were created from the active `pirate-v2` working tree snapshots.
2. The snapshots were committed and pushed to:
   - `pirate-social-club/web`
   - `pirate-social-club/contracts`
3. The in-place workspace directories were then attached to those new repos locally.
4. `core` was updated to ignore those paths and stop tracking runtime files under them.

## Workspace Rule

If this workspace contains:

- `pirate-web/`
- `pirate-contracts/`

they should be treated as nested standalone repos, not as part of tracked `core`.

## Canonical Ownership

- `core` owns shared specs, docs, config, db, scripts, and Lit actions
- `web` owns Storybook, UI primitives, compositions, and the future app runtime
- `contracts` owns the Story contract workspaces and tests

## Definition Of Done

This extraction work is complete when:

- `core` contains system-definition material only
- runtime work lands in `web` and `contracts`
- `core` no longer creates uncertainty about where production code lives
