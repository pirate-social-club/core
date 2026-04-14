# References

This directory is for non-canonical reference material in `pirate-social-club/core`.

Current status:

- `references/` is not the source of truth for any active runtime
- production runtime work belongs in sidecar repos such as `pirate-api/`, not in `core/references/`
- historical prototypes may remain here when they are still useful as context

Template status:

- the old `references/templates/api-worker-auth-first-slice/` implementation tree is retired and no longer carries generated compatibility outputs
- generated compatibility artifacts now live under `specs/api/compatibility/`
- historical prototypes may remain here when they are still useful as context

Important:

- do not treat `references/` as the source of truth for the active API runtime
- prefer the standalone runtime repos for implementation details
- prefer `specs/`, `docs/`, `db/`, and `scripts/` in `core` for shared system definition

There is no current compatibility build target under `references/`.
