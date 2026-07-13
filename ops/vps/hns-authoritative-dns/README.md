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
- a separate keyless, synced mainnet `hsd` process with authenticated RPC bound
  to loopback/private networking for expiry observation and revalidation

SQLite is the fastest way to get to one working VPS.

If the single-node control plane grows, move to PostgreSQL later without changing the product model.

## Bring-up

Do not enable namespace attachment or the API revalidation sweep until `hsd`
has completed initial sync, reports `blocks == headers`, matches the configured
network, and satisfies the configured maximum tip age. The observer has no
wallet and no DNS-serving role.

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

## DNSSEC is an explicit serving prerequisite

Setting `gsqlite3-dnssec=yes` only enables backend support; it does not sign a
zone. When `PDNS_SECURE_NEW_ZONES=true`, the HNS verifier asks the PowerDNS API
to create new zones with `dnssec: true` and `api_rectify: true`. PowerDNS then
generates key material in the creation operation, and `/ensure-zone` returns
the active DS records that the root owner must publish in Handshake.

Safety rules:

- existing unsigned zones are never silently assigned a new key
- configuring TLSA associations while a selected zone is unsigned fails closed
- a signed child zone is not externally authenticated until its matching DS is
  published in the Handshake parent and independently validated
- recover the existing key for tag `24637` before touching the `pirate.` DS;
  otherwise perform a deliberate DS rollover instead of generating over it

Back up the PowerDNS SQLite database and cryptokeys before enabling automated
creation. The private DNSSEC key and the matching parent DS are one lifecycle.

## DANE-EE TLSA lifecycle

The public gateway uses one explicitly managed catchall certificate/key and
publishes `TLSA 3 1 1 <SPKI-SHA256>` in DNSSEC-signed zones. Do not publish a
single wildcard digest for Caddy's on-demand internal certificates: those use
different keys per hostname.

Managed owners are:

- `_443._tcp.<zone>.` for the apex
- `*.<zone>.` for names that exist only through wildcard DNS
- `_443._tcp.<host>.<zone>.` only when `<host>.<zone>.` is already an explicit
  A, AAAA, CNAME, HTTPS, or SVCB node

That last rule matters. Creating `_443._tcp.app.<zone>` also creates
`app.<zone>` as an empty non-terminal. If `app.<zone>` previously depended on
wildcard A synthesis, an eager explicit TLSA record would make its A lookup
return NODATA. The tool derives explicit TLSA owners from concrete web nodes
instead of hard-coding `app`, `api`, or `profile`.

The stateful tool is:

```bash
# Configure/restart the verifier with this association before bootstrap so a
# concurrently-created zone cannot omit it. The CLI authenticates to the
# verifier and checks its live /health response; an operator-shell export alone
# is deliberately insufficient.
# HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS='3 1 1 <initial-spki-sha256>'
export HNS_VERIFIER_URL=http://127.0.0.1:4048
export HNS_VERIFIER_AUTH_TOKEN='<from Infisical>'
export HNS_AUTHORITATIVE_TLSA_TTL=300
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts bootstrap \
  --cert /etc/caddy/hns-dane/current/cert.pem

bun ops/vps/hns-authoritative-dns/manage-tlsa.ts ready

# after ready: install/reload the static DANE Caddy config, then prove the
# actual served SPKI before changing any provisioning configuration
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts activated \
  --probe-address <edge-ip> --probe-host app.pirate

# Re-probe and finalize the bootstrap.
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts retire \
  --probe-address <edge-ip> --probe-host app.pirate
```

Subsequent key rollover:

```bash
# First update/restart the verifier with BOTH associations. The tool refuses
# prepare unless the running verifier reports that overlap set and matching
# TTL, or if this TTL is shorter than any existing managed TLSA TTL.
# HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS='3 1 1 <old>,3 1 1 <new>'
export HNS_AUTHORITATIVE_TLSA_TTL=300
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts prepare \
  --current-cert /etc/caddy/hns-dane/current/cert.pem \
  --next-cert /etc/caddy/hns-dane/v2/cert.pem

bun ops/vps/hns-authoritative-dns/manage-tlsa.ts ready
# Only now swap the one directory symlink, which switches cert+key together,
# then reload Caddy. `mv -T` requires GNU coreutils (the documented Linux VPS).
ln -s v2 /etc/caddy/hns-dane/current.next
mv -T /etc/caddy/hns-dane/current.next /etc/caddy/hns-dane/current
# systemctl reload caddy
# Keep the verifier on old+new until this proves the live gateway is new.
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts activated \
  --probe-address <edge-ip> --probe-host app.pirate
# Then update/restart the verifier with only the new association before retire,
# or a later ensure-zone write could reintroduce the old record.
# HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS='3 1 1 <new>'
bun ops/vps/hns-authoritative-dns/manage-tlsa.ts retire \
  --probe-address <edge-ip> --probe-host app.pirate
```

`prepare` publishes old and new associations together in one PATCH per zone,
rectifies signed zones, and notifies secondaries. `ready` enforces a two-TTL
wait and re-reads every currently selected zone, including zones created during
the overlap. It refuses a shrunken zone selection, changed TTL, stale TLSA
owner, or unknown association. `retire` probes the real gateway certificate
using the requested SNI and removes the old association only when the served
SPKI is the prepared new value. Unknown or concurrently changed TLSA data and
unsigned zones stop the rollout. `activated` proves that Caddy actually loaded
the new key while the verifier still provisions old+new; this prevents a failed
reload from making concurrently created zones new-only while the gateway still
serves the old key. `retire` repeats the live proof after the verifier changes
to new-only.
The tool authenticates to the running verifier and checks its reported
association set and TLSA TTL at each phase, so a missed/failed service restart
cannot race the bulk rollout or resurrect a retired key. It also requires the
verifier and operator to report the same PowerDNS API URL, preventing a valid
configuration check against one DNS authority followed by writes to another.
Operator commands take an exclusive state-file lock. After an abnormal process
exit, verify that no rollout command is still running before removing a stale
`<state-path>.lock` file.

The tool proves the PowerDNS control-plane state and the served certificate. A
production cutover must additionally query the primary, TSIG secondary, and an
independent validating HNS resolver to prove DNSSEC and TLSA serving end to end.

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
- `manage-tlsa.ts` and `tlsa-rollover.ts`
  Fail-closed initial publication and two-phase DANE-EE key rotation.

## Public V0 Notes

- one VPS can host PowerDNS plus the separate verifier services
- add a second authoritative nameserver later for redundancy
- SQLite is acceptable for public v0 if traffic is modest and backups are disciplined
- do not use a read-only zone-file workflow as the long-term HNS path
