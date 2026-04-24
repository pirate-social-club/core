# Core Target Structure

This document defines the steady-state structure for `pirate-social-club/core`.

## Goal

`core` is the system-definition and integration repo. Runtime product surfaces live in sibling repos and consume the shared definitions from here.

## Canonical Top-Level Roots

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

## Canonical Local Workspace

On this machine, the workspace is:

```text
/home/t42/Documents/pirate-workspace/
  core/
  api/
  web/
  contracts/
  desktop/
  android/
```

The runtime directories are sibling checkouts of standalone repos. They are not part of tracked `core` state.

For sidecar-aware scripts:

1. Keep generated API contract output path-configurable through `API_CONTRACTS_DIR` or `API_CONTRACTS_OUTPUT_FILE`.
2. Keep scripts that need the API checkout path-configurable, usually through `API_DIR`.
3. Move local database and env-file references out of sidecar-private `.local` paths.
4. Use checkout variables in runbooks instead of baking in machine-specific repo paths.

## Completed Decoupling

- `scripts/lib/*` no longer imports runtime repo source.
- API contract generation and Wrangler secret sync are path-configurable.
- Active runbook commands use checkout variables for API and web repo paths.
- Plugin source has been extracted from tracked `core`.

## Do Not Add

Do not add new top-level roots in `core` for:

- `api/`
- `web/`
- `contracts/`
- `android/`
- `ios/`
- `desktop/`
- standalone plugin packages with their own release lifecycle

Those belong in their own repos under `pirate-social-club`.
