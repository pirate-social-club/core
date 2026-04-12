# Compatibility Artifacts

This directory holds generated compatibility outputs that still need to exist for spec-driven workflows, but do not belong in runtime repos.

Current contents:

- `reference-template-api.ts`
  Generated TypeScript types preserved for compatibility with older tooling that previously read from the retired `references/templates/api-worker-auth-first-slice/` tree.

These files are generated from `specs/api/src/` and should not be edited manually.
