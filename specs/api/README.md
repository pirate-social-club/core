# API Specs

`specs/api/src/` is the source of truth for the OpenAPI spec.

`specs/api/openapi.yaml` is the bundled artifact kept for review, export, and tooling that expects a single file.

`specs/api/openapi-implemented.yaml` is the generated SDK-facing artifact that keeps only operations explicitly marked `x-implemented: true`.

`pirate-api/services/contracts/src/index.ts` is the generated shared contract package consumed by the worker and CLI. It is rebuilt from `specs/api/openapi-implemented.yaml`.

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
- `cd specs/api && bun run bundle:implemented`
  Regenerates the implemented-surface bundle from the bundled spec.
- `rtk bun specs/api/scripts/bundle-openapi-implemented.ts`
  Regenerates `specs/api/openapi-implemented.yaml` by filtering to `x-implemented: true` operations.
- `cd specs/api && bun run generate-reference-template-types`
  Regenerates the reference worker template API types from `specs/api/openapi-implemented.yaml`.
- `rtk bun specs/api/scripts/generate-reference-template-types.ts`
  Rewrites `references/templates/api-worker-auth-first-slice/src/types/api.ts` from the implemented OpenAPI bundle.
- `cd specs/api && bun run generate-api-contracts`
  Regenerates the shared API contracts package consumed by `pirate-api/services/api` and `pirate-api/services/cli`.
- `rtk bun specs/api/scripts/generate-api-contracts.ts`
  Rewrites `pirate-api/services/contracts/src/index.ts` from the implemented OpenAPI bundle.
- `cd specs/api && bun run typecheck-reference-template`
  Runs a strict no-emit TypeScript check over the auth-first reference worker template using the generated API types.
- `rtk bunx tsc -p references/templates/api-worker-auth-first-slice/tsconfig.json`
  Typechecks the reference template directly from the repo root.
- `cd specs/api && bun run typecheck-api-contracts`
  Typechecks the generated API contracts package with its pinned local TypeScript dependency.
- `cd specs/api && bun run verify`
  Rebuilds both bundles, regenerates the reference template types and shared API contracts, validates the provider matrix and examples, and fails if the round-trip changes keys, content, or leaves external refs.
- `rtk bun specs/api/scripts/verify-openapi.ts`
  Verifies the bundled artifacts are in sync with `specs/api/src/`, refreshes the reference template types and shared API contracts, and checks the locked v0 proof/provider rules.
  The script prefers `rtk`-prefixed subprocesses when `rtk` is available and falls back to plain `bun`/`bunx` when run directly in a non-RTK environment.
- `cd specs/api && bun run validate-provider-matrix`
  Checks that the bundled verification/community schemas still match the allowed proof-type to provider matrix.
- `rtk bun specs/api/scripts/validate-provider-matrix.ts`
  Verifies the provider matrix invariants against `specs/api/openapi.yaml`.
- `cd specs/api && bun run validate-examples`
  Validates all inline response examples in the bundled OpenAPI file against their media-type schemas.
- `rtk bun specs/api/scripts/validate-openapi-examples.ts`
  Verifies that bundled OpenAPI examples still match the schema subset used in the spec.

## Workflow

1. Edit files under `specs/api/src/`.
2. Run `rtk bun specs/api/scripts/verify-openapi.ts`.
3. Review the resulting diff in `specs/api/openapi.yaml`, `specs/api/openapi-implemented.yaml`, `references/templates/api-worker-auth-first-slice/src/types/api.ts`, and `pirate-api/services/contracts/src/index.ts`.
4. Use `specs/api/openapi-implemented.yaml` as the generated-client and SDK input surface.
