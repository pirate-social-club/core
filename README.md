# Pirate Social Club Core

This repository backs `pirate-social-club/core`.

It is the integration repo for Pirate Social Club system design and shared product definition work:

- specs
- migrations
- Lit actions and control-plane scripts
- shared config
- docs and references that define how the runtime repos fit together

Current tracked roots:

- `db/` for Turso/libSQL migration roots
- `specs/` for API, contract, and domain design
- `references/` for local upstream or discussion-only code that informs v2 but is not part of the active workspace
- `docs/`, `config/`, and `scripts/` for operational docs and supporting config checks

Optional local runtime checkouts may still be placed at:

- `pirate-web/` -> `pirate-social-club/web`
- `pirate-contracts/` -> `pirate-social-club/contracts`

Those directories are no longer part of the tracked `core` repository. They are workspace sidecars only.

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

Boundary rules live in [docs/repo-boundaries.md](/home/t42/Documents/pirate-v2/docs/repo-boundaries.md).
Target steady-state structure lives in [docs/core-target-structure.md](/home/t42/Documents/pirate-v2/docs/core-target-structure.md).
The split record lives in [docs/extraction-plan-web-contracts.md](/home/t42/Documents/pirate-v2/docs/extraction-plan-web-contracts.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

If you run a modified version of this software for users over a network, you must make the corresponding source available under the same license.
