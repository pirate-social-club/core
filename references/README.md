# References

This directory holds local code and documents that are useful as upstream reference material but are not part of the active Pirate v2 workspace.

## Layout

- `upstream/`
  - local checkouts of external repos or sidecar projects kept for design, contract, or architecture reference
  - tracked manifest lives in `upstream/README.md`

## Current Upstreams

- `upstream/majeur/`
  - Majeur DAO framework reference checkout
- `upstream/multisig/`
  - Multisig wallet reference checkout

These directories are intentionally ignored by the root repo because they carry their own git history and are not shipped as part of Pirate v2.

Use `upstream/README.md` as the canonical tracked record for origin URLs, pinned commits, and local checkout expectations.
