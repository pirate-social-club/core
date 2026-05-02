# HNS Verifier Service

This service hosts Pirate's PowerDNS-backed HNS verifier and zone-provisioning runtime.

## Responsibilities

- inspect whether Pirate has already provisioned a delegated HNS child zone
- verify owner-managed HNS TXT challenges through configured HNS-aware recursive resolvers
- create the `<root>.` zone in PowerDNS when Pirate-managed delegation is observed
- publish `_pirate.<root>` TXT records for verification sessions
- trigger PowerDNS rediscovery after zone updates so delegated roots become authoritative immediately
- verify TXT challenges against the same authoritative source of truth PowerDNS serves

## Platform-managed roots

Pirate operates platform-managed roots that should be bootstrapped via `/ensure-zone` rather than
waiting for external Handshake delegation. These roots receive wildcard web-routing records and
use the HNS public gateway for HTTP resolution.

Current platform-managed roots:

- `pirate` — human public profiles
- `clawitzer` — agent public identities

## Endpoints

- `GET /health`
- `GET /inspect?root_label=<root>`
- `POST /ensure-zone`
- `POST /publish-txt`
- `POST /verify-txt`

## Environment

- `HNS_VERIFIER_HOST`
- `HNS_VERIFIER_PORT`
- `HNS_VERIFIER_AUTH_TOKEN`
- `HNS_OWNER_MANAGED_RESOLVERS`
- `HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS`
- `PDNS_SQLITE_DATABASE`
- `PDNS_DEFAULT_SOA_CONTENT`
- `PDNS_REDISCOVER_COMMAND`
- `HNS_AUTHORITATIVE_NAMESERVERS`
- `HNS_AUTHORITATIVE_TTL`
- `HNS_AUTHORITATIVE_NAMESERVER_IPV4`
- `HNS_AUTHORITATIVE_APEX_IPV4`
- `HNS_AUTHORITATIVE_PROFILE_IPV4`
- `HNS_AUTHORITATIVE_WILDCARD_IPV4`

`HNS_OWNER_MANAGED_RESOLVERS` is a comma-separated list of trusted HNS-aware recursive resolver
IP addresses. The verifier uses these resolvers for owner-managed NS/TXT checks, including
underscore-prefixed challenge names such as `_pirate.<root>`. Each resolver query is bounded by
`HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS` so the API caller sees a verifier result instead of waiting
on OS-level DNS retry behavior.

For the platform-owned `pirate.` root, prefer an HNS-native nameserver:

- child zone NS: `ns1.pirate.`
- child zone A: `ns1.pirate. -> <authoritative-dns-ip>`
- parent Handshake resource: `GLUE4 ns1.pirate. <authoritative-dns-ip>`

Do not rely on `ns1.pirate.sc.` for censorship-resistant resolution; that makes the Handshake
parent delegation depend on ICANN DNS.

## Local Usage

Run the service from the repo root:

```bash
rtk bun services/verifier/hns/src/server.ts
```
