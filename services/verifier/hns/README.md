# HNS Verifier Service

This service hosts Pirate's PowerDNS-backed HNS verifier and zone-provisioning runtime.

## Responsibilities

- inspect whether Pirate has already provisioned a delegated HNS child zone
- create the `<root>.` zone in PowerDNS when Pirate-managed delegation is observed
- publish `_pirate.<root>` TXT records for verification sessions
- verify TXT challenges against the same authoritative source of truth PowerDNS serves

## Endpoints

- `GET /health`
- `GET /inspect?root_label=<root>`
- `POST /publish-txt`
- `POST /verify-txt`

## Environment

- `HNS_VERIFIER_HOST`
- `HNS_VERIFIER_PORT`
- `HNS_VERIFIER_AUTH_TOKEN`
- `PDNS_API_URL`
- `PDNS_SERVER_ID`
- `PDNS_API_KEY`
- `HNS_AUTHORITATIVE_NAMESERVERS`
- `HNS_AUTHORITATIVE_TTL`
- `HNS_AUTHORITATIVE_APEX_IPV4`
- `HNS_AUTHORITATIVE_PROFILE_IPV4`
- `HNS_AUTHORITATIVE_WILDCARD_IPV4`

## Local Usage

Run the service from the repo root:

```bash
rtk bun services/verifier/hns/src/server.ts
```
