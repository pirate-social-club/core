# Pirate Core

`core` is Pirate's shared system-definition and integration repo. It is not a
frontend or backend runtime; the current product runtimes are `api-next` and
`pirate-web-solid`.

It currently tracks:

- `specs/` for API, contract, and domain definitions
- `db/` for control-plane and community migration roots
- `docs/`, `config/`, `scripts/`, and `lit-actions/` for operational design and shared tooling
- `ops/` for tracked operational deployment assets
- `packages/` and narrowly scoped `services/` for shared domain and operator tooling
- `references/` for upstream, prototype, and template material

Canonical local workspace layout:

```text
/media/t42/codedrive/Code/pirate-workspace/
  core/              -> shared definitions and operations
  api-next/          -> current backend/API runtime
  pirate-web-solid/  -> current frontend and Worker runtime
```

Those sibling repos are not tracked by `core`.

The long-term boundary is for `core` to stay focused on shared definitions and
operational assets while runtime surfaces live in their own repos. New product
runtime work belongs in `api-next` or `pirate-web-solid`, not here.

Workspace and docs map live in [docs/README.md](docs/README.md). Boundary rules live in [docs/repo/repo-boundaries.md](docs/repo/repo-boundaries.md). Target structure lives in [docs/repo/core-target-structure.md](docs/repo/core-target-structure.md).

## License

Licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
