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

The package has no runtime dependencies and does not require the root Web
checkout, the API checkout, a Core checkout, a database, credentials, or a
networked service. The plan provisions only the pinned Bun runtime, then runs
the package's binary-codec contract test directly from source, followed by
import lint.
Typechecking remains on hosted CI because the package's native-preview `tsgo`
toolchain is a frequently changing development dependency and is not needed
to validate this runtime-only gate.

Build-provenance generation and its packaging contract test remain hosted-only;
the isolated gate does not invoke Git from the source archive.

Public-export, transport, reducer, scoring, serialization, session-host,
WebSocket lifecycle, and commit-scheduler tests remain hosted-only for now:
they are too expensive or depend on timer/event-loop behavior for the first
bounded, source-only gate.

The root Web test/type surface is intentionally excluded from the first gate:
its package graph includes `file:` dependencies on API contracts and local Web
packages. A later multi-checkout provisioning design may expand the gate, but
the first gate must not silently depend on files outside the Radicle checkout.

## API

Repository: `pirate-api` (`rad:z2g5M6jqfcwzJobizqRbNCakDsdpU`)

Initial gates: `services/shared` and `services/contracts`.

Both packages have their own `bun.lock`, use only same-repository source, and
can run deterministic type checks without Core, Web, databases, credentials,
or network access. The Ambient plan will use one `bun_get` action per package,
then run each package's `check` script.

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
