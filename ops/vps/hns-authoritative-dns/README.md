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

For public web/profile routing, this should remain a wildcard-at-root model, not one DNS record per user handle.
See [hns-authoritative-dns.md](../../../specs/domain/hns-authoritative-dns.md).

## Recommended Stack

- PowerDNS Authoritative
- writable backend via SQLite for single-node public v0
- PowerDNS HTTP API bound to loopback
- Pirate HNS verifier/provisioner calling the API to create zones and publish `_pirate.<root>` TXT records

SQLite is the fastest way to get to one working VPS.

If the single-node control plane grows, move to PostgreSQL later without changing the product model.

## Bring-up

Required env (no defaults — a stale value here publishes records pointing at a
machine we do not control):

```bash
export EDGE_PUBLIC_IP=<this host's public IP>   # ns1 + gateway
export NS2_IP=<secondary nameserver IP>         # different provider
export PDNS_API_KEY=<random>                    # via Infisical, never in pdns.conf
```

One-time bootstrap (the container runs as uid 953, so the data dir must be
writable by it, and the SQLite schema must exist before first start):

```bash
mkdir -p data && sudo chown -R 953:953 data
docker run --rm --user 953:953 -v "$PWD/data:/var/lib/powerdns" \
  --entrypoint /bin/sh powerdns/pdns-auth-51 \
  -c 'sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/local/share/doc/pdns/schema.sqlite3.sql'

docker compose up -d
docker exec pirate-hns-authdns pdnsutil generate-tsig-key pirate-axfr hmac-sha256
# put the key name in the verifier's PDNS_AXFR_TSIG_KEY_NAME, and the key
# secret in the secondary's config
```

## Replication

Zones are created as **Master**, not Native. PowerDNS accepts `/notify` on a
Native zone but silently drops it, so a Native zone would never reach the
secondary — the redundancy would be fiction. `primary=yes` plus `also-notify`
(compose arg, from `NS2_IP`) makes NOTIFY real.

AXFR is denied by source IP (`allow-axfr-ips=127.0.0.1`) and authorized by
**TSIG** instead: the verifier sets `TSIG-ALLOW-AXFR` on every zone it
provisions, so newly delegated community zones replicate without editing any
config. Verified against this compose file: AXFR from a non-allowlisted source
without TSIG is refused; with the TSIG key it transfers the full signed zone.

## Canonical Source of Truth

The PowerDNS backend is the authoritative child-zone source of truth for Pirate-managed HNS roots.

That means:

1. Handshake parent inspection checks delegation posture such as `NS` and glue
2. Pirate provisions `<root>.` as a zone in PowerDNS
3. Pirate publishes `_pirate.<root>` TXT in that zone via the PowerDNS API
4. PowerDNS serves the zone
5. the authority-health check reads it back through the serving path

Ownership proof never comes from this backend — reading back a record Pirate
wrote proves nothing about the requesting user. See "Verification Assertions"
in [hns-authoritative-dns.md](../../../specs/domain/hns-authoritative-dns.md).

For the `pirate.` and `clawitzer.` roots specifically, PowerDNS may also serve wildcard web-routing records for HNS-hosted public profile and agent traffic.
That should be one wildcard record per root, not per-user or per-agent records.

The corresponding HTTP origin for those wildcard records lives in:

- [ops/vps/hns-public-gateway](../hns-public-gateway/README.md)

Do not use parent-side TXT values in the Handshake root resource as the source of truth after `NS` delegation.

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
