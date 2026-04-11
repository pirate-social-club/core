# TUI Split Record

This document records the intended split of `pirate-tui/` out of `pirate-social-club/core`.

## Goal

- `pirate-social-club/tui` becomes the canonical terminal client repo
- `core` stops tracking `pirate-tui/`
- any local checkout at `pirate-tui/` becomes a sidecar repo, like `pirate-api/`, `pirate-web/`, and `pirate-contracts/`

## Current State

- `pirate-tui/` is tracked directly inside `core`
- the root README and boundary docs now mark that as a temporary exception
- `scripts/extract-tui-subtree.sh` can create a subtree split branch from the tracked history

## Planned Steps

1. Create or verify the target GitHub repo: `pirate-social-club/tui`
2. Run `scripts/extract-tui-subtree.sh` from a clean `core` working tree
3. Push the split branch to the new repo
4. Remove tracked `pirate-tui/` files from `core`
5. Add `pirate-tui/` to root `.gitignore`
6. Reattach `pirate-tui/` locally as a nested standalone repo if this workspace still needs it

## Definition Of Done

- runtime TUI work lands in `pirate-social-club/tui`
- `core` keeps only shared specs, docs, db, config, scripts, lit actions, and references
- the workspace layout remains convenient without making `core` a shadow monorepo
