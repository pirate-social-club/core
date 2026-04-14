# HNS Authoritative DNS Deployment

This directory contains the tracked deployment config for Pirate-managed HNS authoritative DNS.

The recommended production direction is `PowerDNS Authoritative`, not CoreDNS file zones.

## Why PowerDNS

Pirate needs to support many delegated Handshake roots, with each root becoming its own child zone:

- `infinity.`
- `kanye.`
- `artist.`
- hundreds more over time

That requires:

- dynamic zone creation
- record updates tied to verification sessions
- one canonical source of truth shared by DNS serving and TXT verification
- an operational API that Pirate's HNS verifier can call directly

PowerDNS fits that model better than file-oriented DNS servers.

## Recommended Stack

- PowerDNS Authoritative
- writable backend via SQLite for single-node public v0
- PowerDNS HTTP API bound to loopback
- Pirate HNS verifier/provisioner calling the API to create zones and publish `_pirate.<root>` TXT records

SQLite is the fastest way to get to one working VPS.

If the single-node control plane grows, move to PostgreSQL later without changing the product model.

## Canonical Source of Truth

The PowerDNS backend is the authoritative child-zone source of truth for Pirate-managed HNS roots.

That means:

1. Handshake parent inspection checks delegation posture such as `NS` and glue
2. Pirate provisions `<root>.` as a zone in PowerDNS
3. Pirate publishes `_pirate.<root>` TXT in that zone via the PowerDNS API
4. PowerDNS serves the zone
5. `/verify-txt` verifies against that same authoritative child-zone data path

Do not use parent-side TXT values in ShakeStation as the source of truth after `NS` delegation.

## Files

- `compose.yaml`
  Local/VPS PowerDNS container definition.
- `config/pdns.conf`
  Base PowerDNS configuration for a writable authoritative deployment.
- `env/pdns.env.example`
  Example runtime env contract for the API-enabled authoritative server.

## Public V0 Notes

- one VPS can host PowerDNS plus the separate verifier services
- add a second authoritative nameserver later for redundancy
- SQLite is acceptable for public v0 if traffic is modest and backups are disciplined
- do not use a read-only zone-file workflow as the long-term HNS path
