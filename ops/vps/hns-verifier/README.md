# HNS Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted HNS verifier/provisioner.

The shared public Caddy ingress uses the pinned `caddy-ratelimit` module for
`GET /spaces/resolve`. Build it with
`bin/build-rate-limited-caddy.sh /usr/local/bin/pirate-caddy`, install
`systemd/caddy-rate-limited.override.conf` as the Caddy service override, and
validate the Caddyfile with the custom binary before restarting Caddy. The
tracked ingress policy permits 30 resolve requests per IPv4 address or IPv6
`/64` in a sliding one-minute window. Other verifier routes are unaffected.

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

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-verifier.env.example`
- `caddy/Caddyfile.example`
- `systemd/pirate-hns-verifier.service`
