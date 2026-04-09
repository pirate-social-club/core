# API Specs

`specs/api/src/` is the source of truth for the OpenAPI spec.

`specs/api/openapi.yaml` is the bundled artifact kept for review, export, and tooling that expects a single file.

## Layout

- `src/openapi.yaml`
  Root spec that composes path and component fragments with external `$ref`s.
- `src/paths/*.yaml`
  Path items grouped by API family.
- `src/components/parameters.yaml`
  Shared path and query parameters.
- `src/components/responses.yaml`
  Shared response objects.
- `src/components/schemas/*.yaml`
  Schemas grouped by bounded context.

## Commands

- `cd specs/api && bun run split`
  Alias for the one-time migration helper.
- `rtk bun specs/api/scripts/split-openapi.ts`
  One-time migration helper that splits the current bundled file into the modular source tree.
- `cd specs/api && bun run bundle`
  Regenerates the bundled artifact from `src/`.
- `rtk bun specs/api/scripts/bundle-openapi.ts`
  Regenerates `specs/api/openapi.yaml` from `specs/api/src/`.
- `cd specs/api && bun run verify`
  Rebuilds the bundle and fails if the round-trip changes keys, content, or leaves external refs.
- `rtk bun specs/api/scripts/verify-openapi.ts`
  Verifies the bundled artifact is in sync with `specs/api/src/`.

## Workflow

1. Edit files under `specs/api/src/`.
2. Run `rtk bun specs/api/scripts/bundle-openapi.ts`.
3. Review the resulting diff in `specs/api/openapi.yaml`.
