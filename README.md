# Pirate Social Club Core

This repository backs `pirate-social-club/core`.

It is the integration repo for Pirate Social Club system design and shared product definition work:

- specs
- migrations
- Lit actions and control-plane scripts
- shared config
- active exploratory web and contract work that has not been split into its long-term repo yet

Current active roots:

- `pirate-web/` for frontend UI and Storybook work
- `pirate-contracts/` for active Solidity workspaces
- `db/` for Turso/libSQL migration roots
- `specs/` for API, contract, and domain design
- `references/` for local upstream or discussion-only code that informs v2 but is not part of the active workspace
- `docs/`, `config/`, and `scripts/` for operational docs and supporting config checks

`pirate-web/` and `pirate-contracts/` are transitional roots here. They are active surfaces today, but they should be treated as extraction candidates rather than permanent `core` structure.

Current active contract workspaces live under `pirate-contracts/story/`:

- `delivery/` for locked-asset purchase entitlement and access control
- `scrobble/` for Story-side track registration and scrobble events

Parked upstream repos live under `references/upstream/`:

- `references/upstream/majeur/`
- `references/upstream/multisig/`

Those directories are local upstream sidecars, ignored by the root repo, and not part of the active Pirate Social Club runtime surface.

## Repo Role

This repo is not the forever-home of every production surface.

Long-term production repos now live under the `pirate-social-club` GitHub organization:

- `android`
- `ios`
- `web`
- `api`
- `contracts`
- `desktop`
- `core`

This `core` repo exists to hold shared system definition and integration work across those surfaces.

Boundary and extraction rules live in [docs/repo-boundaries.md](/home/t42/Documents/pirate-v2/docs/repo-boundaries.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

If you run a modified version of this software for users over a network, you must make the corresponding source available under the same license.
