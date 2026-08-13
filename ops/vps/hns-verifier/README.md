# HNS Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted HNS verifier/provisioner.

The shared public Caddy ingress is owned by `hns-public-gateway`. This role does
not install or record `caddy.service` units or drop-ins; its release owns only
the verifier service.

Use it together with:

- [services/verifier/hns](../../../services/verifier/hns/README.md)
- [ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md)

## Scope

This service is the application-facing control layer for HNS namespace verification.

It should:

- verify owner-managed HNS TXT challenges from the live Handshake root resource
- read the live parent resource, root existence, and expiry from an authenticated, synced mainnet
  `hsd` observer through `getnameresource`, `getnameinfo`, `getblockchaininfo`, and `getblockheader`
- expose authenticated parent NS, glue, and DS observations with their chain
  anchor through `/observe-root-parent`
- validate the managed serving path through `/observe-root-authority`, using
  BIND `delv` with the HSD-derived root DS as its trust anchor plus direct
  per-authority SOA queries for reachability and serial parity
- talk to the loopback-only PowerDNS API
- create zones after delegation is observed
- publish `_pirate.<root>` TXT records for delegated Pirate-managed sessions
- verify TXT challenges against the same authoritative backend

Owner-managed root-resource queries use that same authenticated observer; no public explorer is in
the ownership path. Set `HNS_CHAIN_RPC_TIMEOUT_MS` to keep responses inside the API timeout budget.

`HNS_CHAIN_RPC_URL`, `HNS_CHAIN_RPC_API_KEY`,
`HNS_CHAIN_MAX_TIP_AGE_SECONDS`, and `HNS_EXPIRY_HORIZON_BLOCKS` are required
before namespace attachment or scheduled revalidation can succeed. The RPC
listener must not be public. Run `hsd` keyless (`--no-wallet`) on mainnet and do
not place Pirate's root wallet or signing keys on this host.

Suggested policy values for operator review, not silent defaults:

- `HNS_EXPIRY_HORIZON_BLOCKS=12960` (approximately 90 days at the target block interval)
- `HNS_CHAIN_MAX_TIP_AGE_SECONDS=1800` (30 minutes; use 3600 only if observation shows false rejections)

Expose the public API through a neutral verifier hostname, for example:

- `https://verifier.pirate.sc/hns`

Dedicated deploy root:

- `/srv/pirate-hns-verifier/current`
- `/srv/pirate-hns-verifier/app`
- `/srv/pirate-hns-verifier/config`

Do not reuse `/srv/pirate-hns`. That root belongs to the state-backup role and
has an independent app pin and rollback lifecycle. Sharing its `app` symlink
causes either role's deployment to invalidate the other's declared app commit.

## Release and atomic cutover

Build both immutable releases from the same clean `origin/main` commit:

```bash
core_commit="$(git rev-parse HEAD)"
bash ops/vps/deployment-tooling/make-app-release.sh /tmp/hns-verifier-release \
  --commit "$core_commit"
bash ops/vps/deployment-tooling/make-release.sh ops/vps/hns-verifier \
  /tmp/hns-verifier-release --app-commit "$core_commit"
```

The release commands fail unless both commits are ancestors of the locally
fetched `origin/main`. An approved disconnected emergency must use the explicit
`--break-glass-non-main <incident-or-change-reference>` flag, which is recorded
in release metadata.

Prepare `/srv/pirate-hns-verifier`, copy both commit-named releases, render
`config/hns-verifier.env` from the secret manager, and point `current` and
`app` at those releases before changing the service unit. Pin the interpreter
used by this role:

```bash
sudo sha256sum "$(readlink -f "$(command -v bun)")" \
  | sudo tee /srv/pirate-hns-verifier/config/RUNTIME_SHA256SUMS >/dev/null
```

Only after the new root is complete, install the unit and switch the service in
one operation window:

```bash
sudo install -m 0644 \
  /srv/pirate-hns-verifier/current/systemd/pirate-hns-verifier.service \
  /etc/systemd/system/pirate-hns-verifier.service
sudo systemctl daemon-reload
sudo systemctl restart pirate-hns-verifier.service
sudo systemctl status --no-pager pirate-hns-verifier.service

sudo /srv/pirate-hns-verifier/current/bin/record-installed-files.sh \
  --deploy-root /srv/pirate-hns-verifier \
  /etc/systemd/system/pirate-hns-verifier.service
sudo /srv/pirate-hns-verifier/current/bin/deployment-status.sh \
  --deploy-root /srv/pirate-hns-verifier --verify
```

Create `/etc/pirate-deployment-verify/verifier.env` for the dedicated root and
enable `pirate-deployment-verify@verifier.timer` only after the one-shot
verification succeeds. The state-backup role remains on `/srv/pirate-hns`; do
not repoint its app symlink until the verifier is healthy on the dedicated
root. Then follow the state-backup role's
[shared-app realignment](../hns-state-backup/README.md#realign-the-app-after-the-verifier-cutover)
and require a clean backup deployment verification before enabling its drift
timer.

Install the BIND client tools providing `/usr/bin/delv` and `/usr/bin/dig`
before starting the unit. The tracked systemd service refuses to start without
both binaries; resolver success alone is not DNSSEC validation.

## Files

- `env/hns-verifier.env.example`
- `caddy/Caddyfile.example`
- `systemd/pirate-hns-verifier.service`
