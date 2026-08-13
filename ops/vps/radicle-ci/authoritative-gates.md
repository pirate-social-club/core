# Initial authoritative CI subsets

Status: design only. These subsets are not enforcement yet. The promotion
controller remains advisory, the workstation delegate remains present, and
GitHub remains the deploy executor until the recovery and mirror cutover
sequence in `operations.md` is complete.

The authoritative subset is the smallest deterministic check that must pass
before a Radicle canonical promotion. It must be secret-free, run entirely in
the isolated Ambient VM, avoid live services and sibling checkouts, and fail
closed when a dependency is not present in the lockfile/cache. Broad platform
matrices and integration suites remain downstream validation until their
inputs can be provisioned explicitly.

## Web

Repository: `pirate-web` (`rad:z3qZx2qJDkjxfjBSPwRva4DutYJTh`)

Initial gate: `packages/karaoke-runtime` only.

The promotion gate is shell-only. It checks the package identity and source
layout, confirms that the package declares no runtime dependencies and that no
`node_modules` tree is present, verifies the binary-codec contract fixtures,
and scans runtime sources for forbidden imports and nondeterministic/browser-
only constructs. It does not start Bun, install packages, or fetch a runtime.

Hosted CI remains responsible for Bun tests, typechecking, build provenance,
packaging, and the wider product matrix. This split is deliberate: the VPS is
the hermetic promotion gate, while hosted CI is the release-validation gate.

Build-provenance generation and its packaging contract test remain hosted-only;
the isolated gate does not invoke Git from the source archive.

Binary-codec, public-export, transport, reducer, scoring, serialization,
session-host, WebSocket lifecycle, and commit-scheduler tests remain
hosted-only for now. They either require a JavaScript runtime or depend on
timer/event-loop behavior that is not suitable for this nested VPS gate.

The root Web test/type surface is intentionally excluded from the first gate:
its package graph includes `file:` dependencies on API contracts and local Web
packages. A later multi-checkout provisioning design may expand the gate, but
the first gate must not silently depend on files outside the Radicle checkout.

## API

Repository: `pirate-api` (`rad:z2g5M6jqfcwzJobizqRbNCakDsdpU`)

Initial gate: repository/source assertions only. The VPS gate must not start
Bun or install packages. Hosted CI remains responsible for the shared and
contracts type checks, plus the API service test and integration matrix.

The API service's full check remains outside the first gate because it has
`file:` dependencies on contracts/shared plus Core and Web packages. It needs
an explicit pinned sibling-source provisioner before it can become an
authoritative check.

## Contracts and freedom-browser

`pirate-contracts` is documentation and delivery material with no executable
test surface, so its authoritative check remains repository hygiene only.
`freedom-browser` already has a CI-proven mainline plan covering its unit and
lint surface; its performance and cross-platform matrix remain supplementary
GitHub validation.

## Expansion rule

Add a check only with a tracked plan, a bounded resource estimate, and a proof
that every input is either in the repository or fetched by a reviewed pre-plan
action. A green proof for a plan that skipped a required input is not eligible
for promotion. Changes to these subsets require a new signed CI proof and an
advisory comparison window before enforcement.
