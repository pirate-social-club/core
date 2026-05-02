# HNS Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted HNS verifier/provisioner.

Use it together with:

- [services/verifier/hns](../../../services/verifier/hns/README.md)
- [ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md)

## Scope

This service is the application-facing control layer for HNS namespace verification.

It should:

- verify owner-managed HNS TXT challenges through configured HNS-aware recursive resolvers
- talk to the loopback-only PowerDNS API
- create zones after delegation is observed
- publish `_pirate.<root>` TXT records for active sessions
- verify TXT challenges against the same authoritative backend

Owner-managed resolver queries must use trusted HNS-aware recursive resolvers and set
`HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS` to keep verifier responses inside the API timeout budget.

Expose the public API through a neutral verifier hostname, for example:

- `https://verifier.pirate.sc/hns`

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-verifier.env.example`
- `caddy/Caddyfile.example`
- `systemd/pirate-hns-verifier.service`
