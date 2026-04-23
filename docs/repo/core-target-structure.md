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

These legacy roots may exist locally for convenience on older checkouts, but they are not part of
tracked `core` state:

- `pirate-api/`
- `pirate-web/`
- `pirate-contracts/`
- `pirate-desktop/`
- `pirate-android/`
- `pirate-analytics/`
- `freedom-browser/`
- `openclaw-pirate-plugin/`

They are sidecar checkouts of the standalone runtime repos. On this machine, the canonical local
workspace is now `/home/t42/Documents/pirate-workspace`.

These sidecars can move out of the `core` checkout once local operators set checkout variables for
the repos they need. The preferred sibling workspace is `/home/t42/Documents/pirate-workspace`.

Before moving sidecars:

1. Keep generated API contract output path-configurable through `API_CONTRACTS_DIR` or
   `API_CONTRACTS_OUTPUT_FILE`.
2. Keep scripts that need the API checkout path-configurable, usually through `API_DIR`.
3. Move any local database or env-file references out of sidecar-private `.local` paths.
4. Replace runbook links that require sidecars in this exact directory with plain repo/path
   references or documented checkout variables.

Completed decoupling:

- `scripts/lib/*` no longer imports source from ignored sidecars such as `pirate-api/`.
- API contract generation and Wrangler secret sync are path-configurable.
- Active runbook commands use checkout variables for API and web repo paths.
- `openclaw-pirate-plugin/` has been extracted from tracked `core`.

## Avoid Adding

Do not add new top-level roots in `core` for:

- `android/`
- `ios/`
- `desktop/`
- `api/`
- repo-shaped plugin packages with their own release lifecycle

Those belong in their own repos under `pirate-social-club`.

`openclaw-pirate-plugin/` has been extracted to `pirate-social-club/pirate-openclaw-plugin`. Local
checkouts should be treated as ignored sidecars, not tracked `core` content.

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
