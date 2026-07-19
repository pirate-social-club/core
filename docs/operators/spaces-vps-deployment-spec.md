# Spaces VPS Deployment Spec

Status: **PRIVATE STAGING DEPLOYED; PUBLIC CUTOVER PENDING**. The intended
verification-only shape is running loopback-only on ns1 while its index syncs.
This is not evidence that `verifier.pirate.sc/spaces` is reachable or that
Pirate can complete a public Spaces verification.

The previously used public address points at retired infrastructure. Treat health checks, DNS,
TLS, API configuration, and one real end-to-end verification as cutover requirements, not as
already-satisfied facts.

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

The deployable verification slice provides:

- a persistent `spaced` instance
- a colocated `spaces-verifier` HTTP service
- outbound Bitcoin RPC access through Chainstack
- a public HTTPS verifier endpoint for Pirate API

Protocol subspace issuance is a separate, blocked slice. The former `subsd`/issuer source was
removed from the API repository. Do not deploy `protocol-spaced`, the pinned historical `subsd`
image, or enable `issuance_mode=spaces_subspace` until a replacement issuer has been designed,
implemented, and exercised end to end. See `ops/vps/community-protocol-subsd/README.md`.

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

The immutable app release must preserve the repo tree. Do not flatten verifier files into ad hoc paths.
`/srv/pirate-spaces/app` is a symlink to `app-releases/<app-commit>`; the role
release records that commit and the deployment verifier checks the complete
app manifest as well as the role manifest.

## Runtime Topology

1. `spaced`
   - runs on the VPS
   - stores chain state under `/srv/pirate-spaces/data/spaced`
   - talks to Chainstack for Bitcoin RPC
   - binds only to `127.0.0.1`
   - is reserved for the verification path

2. `protocol-spaced` — **BLOCKED / NOT DEPLOYABLE**
   - was intended to run on the VPS
   - stores protocol issuance chain/wallet state under `/srv/pirate-spaces/data/protocol-spaced`
   - uses a `spaces_client` build compatible with `subsd`
   - talks to Chainstack for Bitcoin RPC
   - binds only to `127.0.0.1`
   - is reserved for `subsd` and protocol subspace issuance

3. `spaces-verifier`
   - runs on the VPS
   - talks to `spaced` over `127.0.0.1`
   - shells out to the prebuilt native verifier binary
   - binds to `127.0.0.1:4047`

4. `community-protocol-subsd` — **BLOCKED / NOT DEPLOYABLE**
   - was intended to run on the VPS for protocol subspace issuance
   - talks to `protocol-spaced` over `127.0.0.1`
   - keeps durable `subsd` state under `/srv/pirate-spaces/data/subsd`
   - binds internally on `127.0.0.1:7777` through host networking
   - is consumed by `community-protocol-issuer`, not public users

5. reverse proxy
   - terminates TLS for `https://verifier.pirate.sc`
   - forwards only verifier traffic

6. `pirate-api`
   - calls the verifier through `SPACES_VERIFIER_BASE_URL`
   - sends `SPACES_VERIFIER_AUTH_TOKEN`

## Ports

Active verification ports:

- `spaced`: `127.0.0.1:7225`
- `spaces-verifier`: `127.0.0.1:4047`

Reserved historical protocol-issuance ports; do not bind them while that slice is blocked:

- `protocol-spaced`: `127.0.0.1:7226`
- `community-protocol-subsd`: `127.0.0.1:7777`

Expose only the verifier over HTTPS. `spaced`, `protocol-spaced`, and `community-protocol-subsd`
must not be publicly reachable.

## Environment

`/srv/pirate-spaces/config/spaced.env`:

- `SPACED_BIN=/srv/pirate-spaces/bin/spaced-9eb7862`
- `SPACED_CHAIN=mainnet`
- `BITCOIN_RPC_URL`
- `BITCOIN_RPC_USER`
- `BITCOIN_RPC_PASS`
- `SPACED_DATA_DIR=/srv/pirate-spaces/data/spaced`
- `SPACED_RPC_USER`
- `SPACED_RPC_PASS`
- `SPACED_RPC_PORT=7225`
- `SPACED_JOBS=4`

Future `/srv/pirate-spaces/config/protocol-spaced.env` contract; do not render or deploy yet:

- `SPACED_BIN=/srv/pirate-spaces/bin/spaced-0.1.1`
- `SPACED_RPC_URL=http://127.0.0.1:7226`
- `SPACED_DATA_DIR=/srv/pirate-spaces/data/protocol-spaced`
- `BITCOIN_RPC_URL`
- `BITCOIN_RPC_USER`
- `BITCOIN_RPC_PASS`

`/srv/pirate-spaces/config/verifier.env`:

- `SPACED_RPC_URL=http://127.0.0.1:7225`
- `SPACED_RPC_AUTH_TOKEN=<basic-auth-token>`
- `SPACES_VERIFIER_HOST=127.0.0.1`
- `SPACES_VERIFIER_PORT=4047`
- `SPACES_VERIFIER_AUTH_TOKEN=<random-bearer-token>`
- `SPACES_VERIFIER_NATIVE_BIN=/srv/pirate-spaces/current/bin/spaces-verifier-native`
- `SPACES_PUBLISHER_BIN=/srv/pirate-spaces/current/bin/spaces-publisher`
- `SPACES_FABRIC_SEEDS=https://relay-cosmos.spacesprotocol.org,https://relay-atlas.spacesprotocol.org`

The seed list must be explicit in production even when it matches library defaults. Record the
operator and network location for every seed during review. Relay count without operator and
network diversity is not independent redundancy; the two initial upstream seeds are an auditable
starting set, not evidence that the diversity requirement is satisfied.

Pirate API:

- `SPACES_VERIFIER_BASE_URL=https://verifier.pirate.sc/spaces`
- `SPACES_VERIFIER_AUTH_TOKEN=<same-bearer-token>`

Do not set `SPACES_NATIVE_ALLOW_BUILD_FALLBACK=true` on the VPS.

## Process Model

Use `systemd` units:

- `pirate-spaced.service`
- `pirate-spaces-verifier.service`

`pirate-spaces-verifier.service` runs from `/srv/pirate-spaces/app`:

```text
bun services/verifier/spaces/src/server.ts
```

`pirate-community-protocol-subsd.service` is retained only as historical deployment evidence.
Its pinned image must not be started; there is no supported issuer consumer for it.

Do not install or start `pirate-protocol-spaced.service`. A future rebuild must use a
protocol-compatible `spaced` binary and its own data directory. Do not upgrade the verifier
`spaced` in place unless the existing verifier data format has been tested against that exact binary.

## Build Strategy

The role release stages the locked native verifier and publisher binaries from
their pinned sources. Both are covered by the role `SHA256SUMS`; do not build
or download runtime binaries in the app tree after staging.

```bash
bash ops/vps/deployment-tooling/make-app-release.sh /tmp/spaces-out --commit <app-commit>
bash ops/vps/deployment-tooling/make-release.sh ops/vps/spaces-verifier \
  /tmp/spaces-out --app-commit <app-commit>
```

## Deploy Sequence

1. SSH to the VPS.
2. Stage and copy the exact app release and checksummed role release.
3. Point `/srv/pirate-spaces/app` and `/srv/pirate-spaces/current` at the
   commits declared by the role `DEPLOYMENT`.
4. Run deployment verification and require both role and app integrity to pass.
5. Install dependencies only as a separately pinned release asset if runtime
   dependencies change; never mutate the app release in place.
6. Start `pirate-spaced.service`, then `pirate-spaces-verifier.service`.
7. Confirm `GET https://verifier.pirate.sc/spaces/health`.
8. Confirm `GET https://verifier.pirate.sc/spaces/inspect?root_label=@pirate`.
9. Confirm `POST https://verifier.pirate.sc/spaces/verify-publish` with a known session challenge when available.

This sequence brings up verification only. It does not enable community protocol issuance.

## Cutover Rule

Do not treat production Spaces verification as live until all of these are true:

- the VPS verifier can inspect a known root successfully
- the VPS verifier can verify a known published Fabric challenge
- Pirate API can complete a real Spaces verification against the VPS endpoint

The old raw-signature endpoint is not part of the cutover.
