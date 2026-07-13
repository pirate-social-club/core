# HNS Verifier Service

This service hosts Pirate's PowerDNS-backed HNS verifier and zone-provisioning runtime.

## Responsibilities

- inspect Handshake parent state without treating Pirate's own zones as ownership evidence
- verify owner-managed HNS TXT challenges from owner-published evidence
- derive the expiry horizon from authenticated hsd name state anchored to an observed chain tip
- create the `<root>.` zone in PowerDNS when Pirate-managed delegation is observed
- publish `_pirate.<root>` TXT records for delegated Pirate-managed verification sessions
- trigger PowerDNS rediscovery after zone updates so delegated roots become authoritative immediately
- verify post-provision authority health against the serving path without reusing it as ownership proof

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
- `HNS_CHAIN_RPC_URL`
- `HNS_CHAIN_RPC_API_KEY`
- `HNS_CHAIN_RPC_TIMEOUT_MS`
- `HNS_CHAIN_NETWORK`
- `HNS_CHAIN_MAX_TIP_AGE_SECONDS`
- `HNS_EXPIRY_HORIZON_BLOCKS`
- `PDNS_API_URL`
- `PDNS_API_KEY`
- `PDNS_DEFAULT_SOA_CONTENT`
- `HNS_AUTHORITY_HEALTH_RESOLVERS`
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

`HNS_CHAIN_RPC_URL` points at an hsd JSON-RPC endpoint. The verifier calls `getnameinfo` and
`getblockchaininfo`, computes remaining lifetime from `stats.renewalPeriodEnd - blocks`, and records
the expiry height, anchor height/hash/time/network, remaining blocks, configured horizon, and
provider. Set `HNS_EXPIRY_HORIZON_BLOCKS` explicitly to the product's minimum safe remaining
lifetime and `HNS_CHAIN_MAX_TIP_AGE_SECONDS` to the maximum acceptable chain-tip age. The node must
also be caught up to its headers and report `HNS_CHAIN_NETWORK` (default `main`). If required
configuration or evidence is absent, invalid, unavailable, stale, or malformed,
`expiry_horizon_sufficient` is `null` and all expiry-gated capabilities remain withheld. Root or
resource existence is never expiry evidence.

The observer also emits `expiry_root_exists`. A valid synchronized chain tip
plus an empty, expired, or non-registered `getnameinfo` result yields `false`;
malformed or unavailable chain evidence yields `null`. Revalidation can
therefore distinguish a missing root from an unavailable resource scraper
without promoting either condition to positive evidence.

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
