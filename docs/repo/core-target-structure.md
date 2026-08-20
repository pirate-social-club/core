# Core Target Structure

This document defines the steady-state structure for `pirate/core`.

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
/media/t42/codedrive/Code/pirate-workspace/
  core/
  api-next/          current backend/API runtime
  pirate-web-solid/  current frontend and Worker runtime
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
- Active runbook commands use checkout variables for API and frontend runtime
  checkout paths.
- Plugin source has been extracted from tracked `core`.

## Do Not Add

Do not add runtime repository checkouts or new product surfaces under `core`.
In particular, do not add:

- `api-next/`
- `pirate-web-solid/`
- `contracts/`
- `android/`
- `ios/`
- `desktop/`
- standalone plugin packages with their own release lifecycle

Those belong in their own standalone repositories beside `core`. Runtime
implementation work belongs in `api-next` or `pirate-web-solid`; `core` holds
the shared definitions and operational material they may reference.
