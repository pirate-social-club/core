# Compatibility Artifacts

This directory holds generated compatibility outputs that still need to exist for spec-driven workflows, but do not belong in runtime repos.

Current contents:

- `reference-template-api.ts`
  Generated TypeScript types preserved for compatibility with older tooling that previously read from the retired `references/templates/api-worker-auth-first-slice/` tree.
- `fsrs-6-v1.json`
  Immutable scheduler contract fixture shared by Core's contract checks and the
  API's pinned FSRS-6 implementation. It records the provenance commit,
  parameters, units, rounding rules, and reference vectors.

These files are generated from `specs/api/src/` and should not be edited manually.
