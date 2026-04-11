# Pirate Social Club Core

`core` is the shared system-definition repo for Pirate Social Club.

It currently tracks:

- `specs/` for API, contract, and domain definitions
- `db/` for control-plane and community migration roots
- `docs/`, `config/`, `scripts/`, and `lit-actions/` for operational design and shared tooling
- `ops/` for tracked operational deployment assets
- `references/` for upstream, prototype, and template material

Local sidecar checkouts may still exist at:

- `pirate-api/` -> `pirate-social-club/api`
- `pirate-web/` -> `pirate-social-club/web`
- `pirate-contracts/` -> `pirate-social-club/contracts`
- `pirate-tui/` -> `pirate-social-club/tui`

Those sidecars are not tracked by `core`.

The long-term goal is for `core` to stay focused on shared definitions and operational assets while runtime surfaces live in their own repos.

Boundary rules live in [docs/repo/repo-boundaries.md](/home/t42/Documents/pirate-v2/docs/repo/repo-boundaries.md). Target structure lives in [docs/repo/core-target-structure.md](/home/t42/Documents/pirate-v2/docs/repo/core-target-structure.md). Split records live in [docs/repo/extraction-plan-web-contracts.md](/home/t42/Documents/pirate-v2/docs/repo/extraction-plan-web-contracts.md) and [docs/repo/extraction-plan-tui.md](/home/t42/Documents/pirate-v2/docs/repo/extraction-plan-tui.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
