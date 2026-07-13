# HNS Chain Observer

This host role is the keyless Handshake chain reader required by the HNS
verifier's expiry assertion and the API's post-acceptance revalidation sweep.

It is a prerequisite for enabling namespace attachment. It is not:

- authoritative DNS
- a recursive resolver for end users
- a wallet
- a root-record signing or publishing service

## Runtime

The tracked runtime builds Handshake `hsd` v8.0.0 from its upstream release
tarball. Both the release archive and Node base image are pinned by digest:

- hsd tag: `v8.0.0` (`9f013c1cb7f92edf94db69fbd69daf34adf655fb`)
- hsd tarball SHA-256:
  `5280829508c38d96f2eeddcdb0d0fecf07990161d7d6f5495dae7ccb84c21818`
- exact-tag `package-lock.json` SHA-256:
  `326531bb17d526d002e88d1011ae2d1ea92909767dc05b7088adcf3c4b0184d7`
- Node base: `node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2`

The image is built locally rather than trusting an unversioned third-party hsd
image. It runs a pruned mainnet full node with:

- `--no-wallet` fixed in the image entrypoint
- `--no-dns` fixed in the image entrypoint
- inbound P2P listening disabled
- no transaction or address indexes
- authenticated node RPC bound to `127.0.0.1:12037`
- all Linux capabilities dropped and a read-only container filesystem
- persistent chain state at `./data`

Pruning discards historical block bodies after validation but retains the
current chain and name-tree state used by `getnameinfo`. This observer is not an
archive, explorer, wallet-rescan source, or public peer.

The node must:

- complete initial block download before the verifier is enabled
- report `verificationprogress >= 0.999`, keep `blocks == headers`, and have a
  plausible recent median time before container readiness becomes healthy
- expose JSON-RPC only on loopback or a private service network
- require a strong API key
- persist chain data on a monitored volume with sufficient growth headroom
- restart automatically and expose sync/tip-age health to operations

The verifier calls only:

- `getnameinfo <root>`
- `getblockchaininfo`

The API key belongs in Infisical. Render the same value into the compose secret
file and the HNS verifier's `HNS_CHAIN_RPC_API_KEY`. Do not place any Handshake
wallet, seed phrase, or root signing material on this observer.

## Bring-up

Use the Pirate Infisical profile before reading or rendering secrets. From this
directory on the VPS:

```bash
mkdir -p data secrets
sudo install -m 0600 /dev/null secrets/hsd_api_key
# Render a random >=32-character HNS_CHAIN_RPC_API_KEY into secrets/hsd_api_key.

cp env/hsd-observer.env.example .env
sed -i "s/^HSD_UID=.*/HSD_UID=$(id -u)/; s/^HSD_GID=.*/HSD_GID=$(id -g)/" .env
sudo chown -R "$(id -u):$(id -g)" data
docker compose build --pull
docker compose up -d
docker compose ps
```

Do not expose ports `12037`, `5349`, or `5350` in the host firewall. The compose
file uses host networking only so the separately managed verifier can reach the
RPC listener on loopback; the image disables hsd's DNS servers and binds RPC to
`127.0.0.1`.

Configure the verifier only after the container is running:

```text
HNS_CHAIN_RPC_URL=http://127.0.0.1:12037/
HNS_CHAIN_RPC_API_KEY=<same Infisical secret>
HNS_CHAIN_NETWORK=main
HNS_CHAIN_RPC_TIMEOUT_MS=4000
HNS_EXPIRY_HORIZON_BLOCKS=12960
HNS_CHAIN_MAX_TIP_AGE_SECONDS=<approved policy value>
```

The container health check authenticates to `getblockchaininfo` and stays
unhealthy until verification progress is at least `0.999`, `blocks == headers`,
and median time is no more than six hours old on mainnet. hsd does not expose an
`initialblockdownload` field and reports `headers == blocks` during early sync,
so equality alone is not a readiness signal. The six-hour health bound allows
for median-time lag; it does not replace the verifier's stricter
`HNS_CHAIN_MAX_TIP_AGE_SECONDS` policy. An unhealthy state during initial block
download is expected and must not be "fixed" by enabling the verifier early.
Before enabling namespace attachment or revalidation, also exercise the exact
verifier calls:

```bash
key="$(sudo cat secrets/hsd_api_key)"
curl --fail --user "x:${key}" --json \
  '{"method":"getblockchaininfo","params":[]}' \
  http://127.0.0.1:12037/
curl --fail --user "x:${key}" --json \
  '{"method":"getnameinfo","params":["pirate"]}' \
  http://127.0.0.1:12037/
```

Confirm all of the following:

- the reported chain is `main`
- `verificationprogress >= 0.999`
- `blocks == headers`
- the verifier accepts the best-block anchor and configured tip-age policy
- a request without Basic authentication returns `401`
- no wallet API is listening on `12039`
- no hsd DNS service is listening on `5349` or `5350`

## Storage and Recovery

The upstream hsd configuration guide describes pruned mode as remaining below
roughly 400 MB of chain storage. Allocate at least 5 GB to `./data` for database
growth, logs, compaction headroom, and operational margin; alert before the
filesystem reaches 70% utilization and validate real usage after initial sync.

The volume is resynchronizable and contains no keys. Persist it to avoid a new
initial sync after every deployment, but do not classify it with the
non-recoverable Spaces wallet/subsd state. Stop compose cleanly before moving a
volume snapshot. If the database is lost or corrupt, replace it and resync
rather than weakening RPC validation.

## Upgrade Procedure

1. Review the upstream hsd release and changelog.
2. Update the hsd version, release SHA-256, and pinned Node digest in one change.
3. Build and run the container smoke tests locally.
4. Stop the observer, snapshot `./data`, deploy the image, and wait for health.
5. Verify `getnameinfo` and `getblockchaininfo` through the verifier before
   re-enabling expiry-gated operations.

Never deploy a floating `latest` image or silently change the chain network.

## Upstream Security Exception

The v8.0.0 production dependency tree currently reports one unpatched upstream
advisory, inherited through `bsock`, `bcurl`, and `bweb`:
`GHSA-jj93-39pf-7mcf`. It concerns weak SHA-1/MD5 WebSocket handshake helpers in
the vendored Faye implementation; upstream has published no patched hsd release.

This role accepts that advisory only under the enforced containment in this
directory: RPC is authenticated and loopback-only, inbound P2P is disabled,
DNS and wallet services are disabled in the fixed entrypoint, and no proxy or
public route may expose the process. Enabling a wallet, widening any listener,
or placing hsd behind a public proxy requires a fresh security review and is
blocked until the advisory is patched or shown not to affect that new surface.
Review the advisory and rerun `npm audit --omit=dev` on every hsd upgrade; do not
silently broaden this exception to new findings.

## Shadow Observer

The Blink Labs Go node may run alongside `hsd` as a localhost-only, read-only
shadow. Diff the complete `getnameinfo` and `getblockchaininfo` responses used
by the verifier for at least 30 days, including restart, lag, and reorg cases.
Shadow output is telemetry only and must never grant a capability.

Promotion requires an explicit review and a compatibility test suite. Until
then, `hsd` is the production observer.

## Files

- `Dockerfile`: digest-pinned build from the verified hsd release tarball
- `compose.yaml`: keyless, loopback-only, pruned mainnet service
- `docker-entrypoint.sh`: secret validation plus fixed no-wallet/no-DNS flags
- `healthcheck.mjs`: authenticated network and sync readiness check
- `env/hsd-observer.env.example`: deployment secret-file contract
