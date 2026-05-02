# Spaces VPS Deployment Spec

Status: production shape for the VPS-hosted Spaces verifier at `verifier.pirate.sc/spaces`

Related:

- [docs/operators/spaces-repository-map.md](./spaces-repository-map.md)
- [docs/operators/spaces-verification-runtime-contract.md](./spaces-verification-runtime-contract.md)
- [docs/operators/spaces-operator-publish-contract.md](./spaces-operator-publish-contract.md)
- [services/verifier/spaces/README.md](../../services/verifier/spaces/README.md)
- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)
- [ops/vps/spaces-verifier/README.md](../../ops/vps/spaces-verifier/README.md)
- `api/services/api/src/lib/verification/spaces-verifier.ts` in the sibling API repo

## Goal

Run the Spaces verifier sidecar on the VPS so Pirate API can inspect Spaces roots and verify
session-bound Fabric publishes without running `spaced` inside the API worker.

The VPS-hosted slice provides:

- a persistent `spaced` instance
- a colocated `spaces-verifier` HTTP service
- outbound Bitcoin RPC access through Chainstack
- a public HTTPS verifier endpoint for Pirate API

`pirate-api` remains separately deployed. Its only cross-boundary contract is the verifier HTTP API.

## Repository Name

The live verifier source currently stays in `core` under [services/verifier/spaces](../../services/verifier/spaces).
If it is extracted into a standalone GitHub repo, use `pirate-spaces-verifier`.

Do not use `pirate-verifier` for this service. That name is too broad and should be treated as a
archive target.

## Boundary

Use a separate deployment root:

- `/srv/pirate-spaces/app`
- `/srv/pirate-spaces/config`
- `/srv/pirate-spaces/data`
- `/srv/pirate-spaces/log`
- `/srv/pirate-spaces/run`

Use the dedicated Unix user:

- `pirate-spaces`

The VPS checkout must preserve the repo tree. Do not flatten verifier files into ad hoc paths.

## Runtime Topology

1. `spaced`
   - runs on the VPS
   - stores chain state under `/srv/pirate-spaces/data/spaced`
   - talks to Chainstack for Bitcoin RPC
   - binds only to `127.0.0.1`

2. `spaces-verifier`
   - runs on the VPS
   - talks to `spaced` over `127.0.0.1`
   - shells out to the prebuilt native verifier binary
   - binds to `127.0.0.1:4047`

3. reverse proxy
   - terminates TLS for `https://verifier.pirate.sc`
   - forwards only verifier traffic

4. `pirate-api`
   - calls the verifier through `SPACES_VERIFIER_BASE_URL`
   - sends `SPACES_VERIFIER_AUTH_TOKEN`

## Ports

Recommended internal ports:

- `spaced`: `127.0.0.1:7225`
- `spaces-verifier`: `127.0.0.1:4047`

Expose only the verifier over HTTPS. `spaced` must not be publicly reachable.

## Environment

`/srv/pirate-spaces/config/spaced.env`:

- `BITCOIN_RPC_URL`
- `BITCOIN_RPC_USER`
- `BITCOIN_RPC_PASS`
- `SPACED_DATA_DIR=/srv/pirate-spaces/data/spaced`

`/srv/pirate-spaces/config/verifier.env`:

- `SPACED_RPC_URL=http://127.0.0.1:7225`
- `SPACED_RPC_AUTH_TOKEN=<basic-auth-token>`
- `SPACES_VERIFIER_HOST=127.0.0.1`
- `SPACES_VERIFIER_PORT=4047`
- `SPACES_VERIFIER_AUTH_TOKEN=<random-bearer-token>`
- `SPACES_VERIFIER_NATIVE_BIN=/srv/pirate-spaces/app/services/verifier/spaces/native/target/release/spaces-verifier-native`

Pirate API:

- `SPACES_VERIFIER_BASE_URL=https://verifier.pirate.sc/spaces`
- `SPACES_VERIFIER_AUTH_TOKEN=<same-bearer-token>`

Do not set `SPACES_NATIVE_ALLOW_BUILD_FALLBACK=true` on the VPS.

## Process Model

Use `systemd` units:

- `pirate-spaced.service`
- `pirate-spaces-verifier.service`

`pirate-spaces-verifier.service` runs:

```text
bun services/verifier/spaces/src/server.ts
```

from:

```text
/srv/pirate-spaces/app
```

## Build Strategy

Build the native verifier once during deploy:

```bash
cargo build --release --manifest-path /srv/pirate-spaces/app/services/verifier/spaces/native/Cargo.toml
```

The service reuses:

```text
/srv/pirate-spaces/app/services/verifier/spaces/native/target/release/spaces-verifier-native
```

Do not compile Rust on each service restart.

## Deploy Sequence

1. SSH to the VPS.
2. Update `/srv/pirate-spaces/app` to the desired `main` commit.
3. Run `bun install` if dependencies changed.
4. Build `spaces-verifier-native`.
5. Restart `pirate-spaces-verifier.service`.
6. Confirm `GET https://verifier.pirate.sc/spaces/health`.
7. Confirm `GET https://verifier.pirate.sc/spaces/inspect?root_label=@pirate`.
8. Confirm `POST https://verifier.pirate.sc/spaces/verify-publish` with a known session challenge when available.

## Cutover Rule

Do not treat production Spaces verification as live until all of these are true:

- the VPS verifier can inspect a known root successfully
- the VPS verifier can verify a known published Fabric challenge
- Pirate API can complete a real Spaces verification against the VPS endpoint

The old raw-signature endpoint is not part of the cutover.
