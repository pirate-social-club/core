# Spaces VPS Deployment Spec

Status: target production shape for moving the working local Spaces verification stack to the VPS at `173.199.93.117`

Related:

- [docs/operators/spaces-verification-runtime-contract.md](./spaces-verification-runtime-contract.md)
- [docs/operators/spaces-operator-signing-contract.md](./spaces-operator-signing-contract.md)
- [services/verifier/spaces/README.md](../../services/verifier/spaces/README.md)
- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)
- [services/verifier/spaces/scripts/sign-digest.ts](../../services/verifier/spaces/scripts/sign-digest.ts)
- [ops/vps/spaces-verifier/README.md](../../ops/vps/spaces-verifier/README.md)
- [pirate-api/services/api/src/lib/verification/spaces-verifier.ts](../../pirate-api/services/api/src/lib/verification/spaces-verifier.ts)

## Goal

Move the working Spaces verification runtime off the local machine and onto the VPS at
`173.199.93.117` without mixing it into the existing HNS namespace stack.

The VPS-hosted Spaces slice should provide:

- a persistent `spaced` instance
- a colocated `spaces-verifier` HTTP service
- outbound Bitcoin RPC access through Chainstack
- a clean public verifier endpoint that Pirate API can call via `SPACES_VERIFIER_BASE_URL`

The VPS-hosted Spaces slice does not need to host `pirate-api`.

`pirate-api` can stay where it already runs. The only cross-boundary contract is the verifier HTTP
API.

## Recommended Boundary

Do not merge the Spaces runtime into the existing HNS service folder or shared process tree.

Use a separate deployment root on the VPS:

- `/srv/pirate-spaces`

Inside that root, use separate subdirectories:

- `/srv/pirate-spaces/app`
- `/srv/pirate-spaces/config`
- `/srv/pirate-spaces/data`
- `/srv/pirate-spaces/log`
- `/srv/pirate-spaces/run`

Use a dedicated Unix user:

- `pirate-spaces`

Do not run the Spaces services as the same Unix user as the HNS nameserver services.

## Repo Strategy

Use a separate checkout of this repo for the Spaces stack instead of reusing the HNS checkout.

Recommended shape:

- repo remote: same `pirate-v2` origin
- checkout path: `/srv/pirate-spaces/app`
- branch: the branch or commit that contains the verified Spaces runtime
- checkout mode: full monorepo checkout, not a flattened service copy

Reason:

- the verifier and signer code already live in this repo
- a separate checkout keeps service ownership obvious
- separate deploy roots reduce the chance of accidentally sharing env files, ports, or restarts

Do not create a second source repo just for Spaces right now. That would add deployment friction
without improving the runtime boundary.

Separate checkout: yes.
Separate repo: no.

Important:

- the VPS runtime contract assumes the tracked repo layout exists under `/srv/pirate-spaces/app`
- do not deploy only a flat subset of files and then keep legacy paths like `scripts/spaces-verifier.ts`
- when this layout changes, the VPS checkout and systemd unit must be redeployed together

## Runtime Topology

Target topology:

1. `spaced`
   - runs on the VPS
   - stores wallet and chain-related state on VPS disk
   - talks to Chainstack for Bitcoin RPC
   - binds only to `127.0.0.1`

2. `spaces-verifier`
   - runs on the VPS
   - talks to `spaced` over `127.0.0.1`
   - optionally shells out to the native verifier binary
   - exposes a small HTTP API for Pirate
   - should bind to `0.0.0.0` only as a temporary no-domain bring-up mode
   - should bind to `127.0.0.1` once a real HTTPS reverse proxy is in front of it

3. reverse proxy
   - optional but recommended
   - terminates TLS
   - forwards only verifier traffic

4. `pirate-api`
   - stays external to the VPS if desired
   - calls the verifier with `SPACES_VERIFIER_BASE_URL`

## Ports

Recommended internal ports:

- `spaced`: `127.0.0.1:7225`
- `spaces-verifier`: `127.0.0.1:4047`

Recommended public exposure:

- expose only the verifier, not `spaced`
- keep `spaced` firewalled to loopback only

If a public listener is needed before a domain exists:

- exposing `173.199.93.117:4047` with bearer auth is acceptable as a temporary development path
- set `SPACES_VERIFIER_HOST=0.0.0.0` explicitly for that temporary mode
- switch to `SPACES_VERIFIER_HOST=127.0.0.1` once a hostname and HTTPS reverse proxy exist
- prefer a reverse proxy on `173.199.93.117:443`
- do not treat raw public `:4047` as the final production shape

## Data Layout

Recommended persistent data paths:

- `spaced` data dir: `/srv/pirate-spaces/data/spaced`
- verifier temp/runtime dir: `/srv/pirate-spaces/run`
- logs: `/srv/pirate-spaces/log`

Expected `spaced` wallet shape:

- `/srv/pirate-spaces/data/spaced/mainnet/wallets/default`

Do not keep wallet data inside the git checkout.

## Secrets

Do not commit any of these values:

- Chainstack Bitcoin RPC URL
- Chainstack credentials
- `spaced` RPC cookie or derived Basic auth token
- verifier bearer token
- SSH private key material

Recommended env file locations:

- `/srv/pirate-spaces/config/spaced.env`
- `/srv/pirate-spaces/config/verifier.env`

Recommended variables for `spaced.env`:

- `BITCOIN_RPC_URL`
- `BITCOIN_RPC_USER`
- `BITCOIN_RPC_PASS`
- `SPACED_DATA_DIR=/srv/pirate-spaces/data/spaced`

Recommended variables for `verifier.env`:

- `SPACED_RPC_URL=http://127.0.0.1:7225`
- `SPACED_RPC_AUTH_TOKEN=<basic-auth-token>`
- `SPACES_VERIFIER_HOST=127.0.0.1`
- `SPACES_VERIFIER_PORT=4047`
- `SPACES_VERIFIER_AUTH_TOKEN=<random-bearer-token>`
- `SPACES_VERIFIER_NATIVE_BIN=/srv/pirate-spaces/app/services/verifier/spaces/native/target/release/spaces-verifier-native`

Do not rely on request-time `cargo run` on the VPS.

`SPACES_NATIVE_ALLOW_BUILD_FALLBACK=true` is for local development only and should stay unset on the
VPS.

Recommended variable for Pirate API:

- `SPACES_VERIFIER_BASE_URL=https://<verifier-host>`
- `SPACES_VERIFIER_AUTH_TOKEN=<same-bearer-token>`

## Process Model

Use `systemd` units, not ad hoc shell sessions.

Recommended units:

- `pirate-spaced.service`
- `pirate-spaces-verifier.service`

`pirate-spaced.service` responsibilities:

- start after network is online
- read `/srv/pirate-spaces/config/spaced.env`
- run `spaced` with the persistent data dir
- restart on failure

`pirate-spaces-verifier.service` responsibilities:

- start after `pirate-spaced.service`
- read `/srv/pirate-spaces/config/verifier.env`
- run `bun services/verifier/spaces/src/server.ts` from `/srv/pirate-spaces/app`
- restart on failure

## Build Strategy

The VPS should build the native verifier once and reuse the binary.

Build outputs to preserve on the VPS:

- Bun dependencies for the repo checkout
- `services/verifier/spaces/native/target/release/spaces-verifier-native`

Do not compile the Rust binary on every service restart.

The native crate is pinned to the upstream `spacesprotocol/spaces` git revision used during local
validation. Build from that pinned dependency set, then run the verifier with
`SPACES_VERIFIER_NATIVE_BIN`.

The crate also vendors the matching `spacedb` snapshot expected by that pinned `spaces` revision so
the build does not depend on cargo's local git checkout layout.

## Network and Security

Rules:

- `spaced` must not be publicly reachable
- verifier should require bearer auth
- verifier should be TLS-protected if it is reachable over the public Internet
- if no hostname exists yet, raw public `:4047` may be used temporarily with bearer auth and firewalling, but it should be treated as a bring-up phase only
- firewall should allow only:
  - SSH
  - HTTPS for the verifier endpoint
  - any existing HNS ports already in use

If the verifier is exposed on raw IP before a domain is configured, keep that as a temporary stage
only. Long term, give it a dedicated hostname.

Recommended hostname:

- `spaces-verifier.<your-domain>`

## Separation From HNS Stack

The existing HNS services and the new Spaces services may live on the same VPS, but they should be
operationally separate in all of these ways:

- separate Unix user
- separate repo checkout
- separate env files
- separate systemd units
- separate data directories
- separate logs

The only shared resources should be:

- host CPU and memory
- base reverse proxy if one already exists
- standard OS-level monitoring

## Deployment Sequence

Phase 1: prepare the VPS

1. SSH into `173.199.93.117` using the key already present on this machine.
2. Create the `pirate-spaces` user.
3. Create `/srv/pirate-spaces/{app,config,data,log,run}`.
4. Clone this repo into `/srv/pirate-spaces/app`.
5. Install runtime dependencies needed for:
   - Bun
   - Rust/Cargo
   - the `spaced` binary

Phase 2: bring up `spaced`

1. Put Chainstack RPC credentials into `spaced.env`.
2. Start `spaced` against `/srv/pirate-spaces/data/spaced`.
3. Verify local RPC access on `127.0.0.1:7225`.
4. Confirm `getserverinfo`, `getwalletinfo`, and `getspace("@pirate")` all work.

Phase 3: bring up the verifier

1. Build `spaces-verifier-native`.
2. Put verifier secrets into `verifier.env`.
3. Start `pirate-spaces-verifier.service`.
4. Confirm:
   - `GET /inspect?root_label=@pirate`
   - `POST /verify-signature`
   work through the service.

Phase 4: expose the verifier

1. Add TLS termination on the VPS or existing proxy.
2. Publish a stable verifier URL.
3. Restrict inbound access as tightly as possible.

Phase 5: point Pirate at the VPS

1. Set `SPACES_VERIFIER_BASE_URL` on the Pirate API deployment.
2. Set `SPACES_VERIFIER_AUTH_TOKEN` on the Pirate API deployment.
3. Restart Pirate API.
4. Run a real Spaces verification session for `@pirate`.

## Cutover Rule

Do not move the production-facing verification flow to the VPS until all of these are true:

- the local end-to-end Spaces attach flow remains green
- the VPS `spaced` instance can inspect the same root successfully
- the VPS verifier can validate a known-good signature
- Pirate API can complete a real Spaces verification against the VPS endpoint

Local-first, then VPS cutover.

## First Bring-Up Scope

For the first VPS pass, deploy only:

- `spaced`
- `spaces-verifier`

Do not also move:

- `pirate-api`
- the frontend
- the control-plane DB

That keeps the cutover small and easy to reason about.

## Open Decisions

These should be decided before the actual move:

- domain name for the verifier endpoint
- whether the reverse proxy is `nginx` or `caddy`
- whether the verifier will be reachable only by Cloudflare/Worker IPs or generally over HTTPS
- whether operator signing remains local-only for now or also moves to the VPS host

## Recommendation

Use the VPS at `173.199.93.117` for the Spaces runtime.

Keep it separate from HNS by using:

- a dedicated Unix user
- a dedicated repo checkout
- a dedicated `/srv/pirate-spaces` root
- dedicated systemd units

That gives clean operational separation without inventing a second source repo before it is needed.
