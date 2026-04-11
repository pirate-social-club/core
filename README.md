# Pirate Social Club Core

`core` is the shared system-definition repo for Pirate Social Club.

It currently tracks:

- `specs/` for API, contract, and domain definitions
- `db/` for control-plane and community migration roots
- `docs/`, `config/`, `scripts/`, and `lit-actions/` for operational design and shared tooling
- `references/` for upstream or template material
- `pirate-tui/` for the current terminal client, pending extraction to its own repo

Local sidecar checkouts may still exist at:

- `pirate-api/` -> `pirate-social-club/api`
- `pirate-web/` -> `pirate-social-club/web`
- `pirate-contracts/` -> `pirate-social-club/contracts`

Those sidecars are not tracked by `core`.

The long-term goal is for `core` to stay focused on shared definitions while runtime surfaces live in their own repos. `pirate-tui/` is the current exception and should be split out once its standalone repo is in place.

Boundary rules live in [docs/repo-boundaries.md](/home/t42/Documents/pirate-v2/docs/repo-boundaries.md). Target structure lives in [docs/core-target-structure.md](/home/t42/Documents/pirate-v2/docs/core-target-structure.md). Split records live in [docs/extraction-plan-web-contracts.md](/home/t42/Documents/pirate-v2/docs/extraction-plan-web-contracts.md) and [docs/extraction-plan-tui.md](/home/t42/Documents/pirate-v2/docs/extraction-plan-tui.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
