# Pirate Social Club Core

This repository backs `pirate-social-club/core`.

It is the integration repo for Pirate Social Club system design and shared product definition work:

- specs
- migrations
- Lit actions and control-plane scripts
- shared config
- shared web and contract work that is still present locally in `core` while the standalone repos are brought online

Current active roots:

- `pirate-web/` for frontend UI and Storybook work
- `pirate-contracts/` for active Solidity workspaces
- `db/` for Turso/libSQL migration roots
- `specs/` for API, contract, and domain design
- `references/` for local upstream or discussion-only code that informs v2 but is not part of the active workspace
- `docs/`, `config/`, and `scripts/` for operational docs and supporting config checks

`pirate-web/` and `pirate-contracts/` are transitional roots here. Fresh standalone repos now exist at `pirate-social-club/web` and `pirate-social-club/contracts`, but the in-tree copies remain in `core` until the local workspace migration is complete.

Current active contract workspaces live under `pirate-contracts/story/`:

- `delivery/` for locked-asset purchase entitlement and access control
- `scrobble/` for Story-side track registration and scrobble events

Parked upstream repos live under `references/upstream/`:

- `references/upstream/majeur/`
- `references/upstream/multisig/`

Those directories are local upstream sidecars, ignored by the root repo, and not part of the active Pirate Social Club runtime surface.

## Repo Role

This repo is not the forever-home of every production surface.

Current standalone repos under the `pirate-social-club` GitHub organization:

- `web`
- `contracts`
- `core`

Additional runtime repos can be spun out later when they actually exist in this project.

This `core` repo exists to hold shared system definition and integration work across those surfaces.

Boundary and extraction rules live in [docs/repo-boundaries.md](/home/t42/Documents/pirate-v2/docs/repo-boundaries.md).
Target steady-state structure lives in [docs/core-target-structure.md](/home/t42/Documents/pirate-v2/docs/core-target-structure.md).
The current web/contracts extraction path lives in [docs/extraction-plan-web-contracts.md](/home/t42/Documents/pirate-v2/docs/extraction-plan-web-contracts.md).
The executable runbook for the web split lives in [docs/web-extraction-runbook.md](/home/t42/Documents/pirate-v2/docs/web-extraction-runbook.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

If you run a modified version of this software for users over a network, you must make the corresponding source available under the same license.
