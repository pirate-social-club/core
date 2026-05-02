# HNS Verifier Service

This service hosts Pirate's PowerDNS-backed HNS verifier and zone-provisioning runtime.

## Responsibilities

- inspect whether Pirate has already provisioned a delegated HNS child zone
- verify owner-managed HNS TXT challenges from the live Handshake root resource
- create the `<root>.` zone in PowerDNS when Pirate-managed delegation is observed
- publish `_pirate.<root>` TXT records for delegated Pirate-managed verification sessions
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
- `HNS_ROOT_RESOURCE_URL_TEMPLATE`
- `HNS_ROOT_RESOURCE_TIMEOUT_MS`
- `PDNS_SQLITE_DATABASE`
- `PDNS_DEFAULT_SOA_CONTENT`
- `PDNS_REDISCOVER_COMMAND`
- `HNS_AUTHORITATIVE_NAMESERVERS`
- `HNS_AUTHORITATIVE_TTL`
- `HNS_AUTHORITATIVE_NAMESERVER_IPV4`
- `HNS_AUTHORITATIVE_APEX_IPV4`
- `HNS_AUTHORITATIVE_PROFILE_IPV4`
- `HNS_AUTHORITATIVE_WILDCARD_IPV4`

`HNS_ROOT_RESOURCE_URL_TEMPLATE` points at a trusted Handshake chain/resource reader. The template
must contain `{root}` and defaults to `https://shakeshift.com/name/{root}/resources?fetch=main`.
Owner-managed verification reads the live root resource and checks the apex TXT value there. It does
not depend on recursive DNS resolution or `_pirate.<root>` child records.

`HNS_ROOT_RESOURCE_TIMEOUT_MS` bounds the root-resource lookup so the API caller sees a verifier
result inside its timeout budget.

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
