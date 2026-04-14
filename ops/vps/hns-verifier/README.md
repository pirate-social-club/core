# HNS Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted HNS verifier/provisioner.

Use it together with:

- [services/verifier/hns](../../../services/verifier/hns/README.md)
- [ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md)

## Scope

This service is the application-facing control layer for Pirate-managed HNS child zones.

It should:

- talk to the loopback-only PowerDNS API
- create zones after delegation is observed
- publish `_pirate.<root>` TXT records for active sessions
- verify TXT challenges against the same authoritative backend

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-verifier.env.example`
- `systemd/pirate-hns-verifier.service`
