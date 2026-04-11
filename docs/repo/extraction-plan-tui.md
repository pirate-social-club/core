# TUI Split Record

This document records the completed split of `pirate-tui/` out of `pirate-social-club/core`.

## Result

- `pirate-social-club/tui` becomes the canonical terminal client repo
- `core` stops tracking `pirate-tui/`
- any local checkout at `pirate-tui/` becomes a sidecar repo, like `pirate-api/`, `pirate-web/`, and `pirate-contracts/`

## Current State

- `pirate-tui/` is no longer tracked by `core`
- the root `.gitignore` treats `pirate-tui/` as a local sidecar path
- the workspace may still contain a nested `pirate-social-club/tui` checkout at `pirate-tui/`
- `scripts/extract-tui-subtree.sh` remains as the historical extraction helper

## What Changed

1. `pirate-tui/` history was extracted to `pirate-social-club/tui`
2. tracked `pirate-tui/` files were removed from `core`
3. `pirate-tui/` was added to the root `.gitignore`
4. local work at `pirate-tui/` now happens in the standalone repo, not in `core`

## Definition Of Done

- runtime TUI work lands in `pirate-social-club/tui`
- `core` keeps only shared specs, docs, db, config, scripts, lit actions, ops assets, and references
- the workspace layout remains convenient without making `core` a shadow monorepo
