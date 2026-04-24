# Pirate Social Club Core

`core` is the shared system-definition repo for Pirate Social Club.

It currently tracks:

- `specs/` for API, contract, and domain definitions
- `db/` for control-plane and community migration roots
- `docs/`, `config/`, `scripts/`, and `lit-actions/` for operational design and shared tooling
- `ops/` for tracked operational deployment assets
- `references/` for upstream, prototype, and template material

Canonical local workspace layout:

```text
/home/t42/Documents/pirate-workspace/
  core/       -> pirate-social-club/core
  api/        -> pirate-social-club/api
  web/        -> pirate-social-club/web
  contracts/  -> pirate-social-club/contracts
  desktop/    -> pirate-social-club/desktop
  android/    -> pirate-social-club/android
```

Those sibling repos are not tracked by `core`.

The long-term goal is for `core` to stay focused on shared definitions and operational assets while runtime surfaces live in their own repos.

Boundary rules live in [docs/repo/repo-boundaries.md](docs/repo/repo-boundaries.md). Target structure lives in [docs/repo/core-target-structure.md](docs/repo/core-target-structure.md). Split records live in [docs/repo/extraction-plan-web-contracts.md](docs/repo/extraction-plan-web-contracts.md) and [docs/repo/extraction-plan-tui.md](docs/repo/extraction-plan-tui.md). The current desktop replacement plan lives in [docs/repo/desktop-electron-architecture-plan.md](docs/repo/desktop-electron-architecture-plan.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
