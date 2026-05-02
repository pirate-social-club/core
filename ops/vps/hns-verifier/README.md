# HNS Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted HNS verifier/provisioner.

Use it together with:

- [services/verifier/hns](../../../services/verifier/hns/README.md)
- [ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md)

## Scope

This service is the application-facing control layer for HNS namespace verification.

It should:

- verify owner-managed HNS TXT challenges from the live Handshake root resource
- talk to the loopback-only PowerDNS API
- create zones after delegation is observed
- publish `_pirate.<root>` TXT records for delegated Pirate-managed sessions
- verify TXT challenges against the same authoritative backend

Owner-managed root-resource queries must use a trusted Handshake chain/resource reader and set
`HNS_ROOT_RESOURCE_TIMEOUT_MS` to keep verifier responses inside the API timeout budget.

Expose the public API through a neutral verifier hostname, for example:

- `https://verifier.pirate.sc/hns`

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-verifier.env.example`
- `caddy/Caddyfile.example`
- `systemd/pirate-hns-verifier.service`
