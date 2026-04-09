# Extraction Plan: Web And Contracts

This plan describes how to cleanly separate `pirate-web/` and `pirate-contracts/` from `pirate-social-club/core` without turning `core` into a permanent shadow monorepo.

## Current State

### `pirate-social-club/web`

- already exists as a populated org repo
- `core/pirate-web/` has real tracked history in this repo
- `core/pirate-web/` also has substantial uncommitted work right now

### `pirate-social-club/contracts`

- already exists as a populated org repo
- `core/pirate-contracts/` exists in the working tree
- `core/pirate-contracts/` currently has little or no committed history in `core`
- that means a history-preserving extraction from `core` is not the right first move for contracts

## Consequence

The two extractions should not be handled the same way.

- `web` is a history-preserving split problem
- `contracts` is a canonical-home decision problem

## Web Extraction Plan

Use `core/pirate-web/` as a source branch, then compare and reconcile with `pirate-social-club/web`.

### Phase 1: Stabilize

Do not extract while `core/pirate-web/` has a large mixed working tree.

First:

1. finish or park the current `pirate-web/` work in `core`
2. commit web changes in coherent batches
3. make sure the branch is in a state worth splitting

### Phase 2: Produce A Split Branch

When `pirate-web/` is ready:

```bash
rtk git -C /home/t42/Documents/pirate-v2 subtree split --prefix=pirate-web -b core-web-split
```

That creates a branch containing only `pirate-web/` history.

### Phase 3: Reconcile With The Existing `web` Repo

There are two possible outcomes:

1. `core/pirate-web/` is now the canonical successor
   - replace or heavily overwrite `pirate-social-club/web`
2. the existing `pirate-social-club/web` remains canonical
   - manually port selected changes from `core/pirate-web/`

Given the current ambiguity, do not force-push over `pirate-social-club/web` until you explicitly decide which lineage wins.

### Phase 4: Remove The Transitional Root

After extraction and verification:

1. freeze `core/pirate-web/`
2. remove it from `core`
3. keep specs and docs in `core`
4. point readers to `pirate-social-club/web`

## Contracts Extraction Plan

`core/pirate-contracts/` should not be treated like a subtree-history extraction yet.

Because it is not strongly committed in `core`, the first job is to decide whether it is:

1. new incubating contract work that should later move into `pirate-social-club/contracts`, or
2. a duplicate of material that already belongs in `pirate-social-club/contracts`

### Recommended Path

1. keep `pirate-social-club/contracts` as the canonical contracts repo
2. use `core/specs/contracts/` for contract intent and architecture
3. treat `core/pirate-contracts/` as temporary integration work only
4. when ready, port or move the relevant implementation into `pirate-social-club/contracts`

If contract implementation work becomes active here before extraction, then commit it coherently and revisit whether subtree split is useful later.

## Recommended Order

1. clean up and stabilize `core/pirate-web/`
2. decide whether `pirate-social-club/web` or `core/pirate-web/` is canonical
3. extract `web`
4. keep `contracts` canonical in `pirate-social-club/contracts`
5. gradually eliminate `core/pirate-contracts/` as a permanent root

## Definition Of Done

This extraction work is complete when:

- `core` contains system-definition material only
- `pirate-social-club/web` is the clear canonical web repo
- `pirate-social-club/contracts` is the clear canonical contracts repo
- `core` no longer creates uncertainty about where production code lives
