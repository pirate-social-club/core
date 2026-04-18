# HNS Public Gateway

This service is the VPS-facing web gateway for real `name.pirate` profile requests.

It is the server-side counterpart to Freedom's HNS browsing path:

- Freedom/browser resolves `blackbeard.pirate`
- PowerDNS routes `*.pirate` to Pirate's VPS
- this gateway reads `Host`, resolves the profile through Pirate's public API, and renders the public profile HTML

## Responsibilities

- serve `GET /health`
- accept host-based `.pirate` requests
- map `<label>.pirate` -> `<label>.pirate` Pirate handle
- call `GET /public-profiles/:handle`
- render the same public profile surface used for the ICANN fallback
- redirect renamed handles to the current HNS host

## Environment

- `HNS_PUBLIC_GATEWAY_HOST`
- `HNS_PUBLIC_GATEWAY_PORT`
- `HNS_PUBLIC_GATEWAY_ROOT_SUFFIX`
- `HNS_PUBLIC_GATEWAY_EXTERNAL_SCHEME`
- `HNS_PUBLIC_API_ORIGIN`
- `HNS_PUBLIC_APP_ORIGIN`

## Local Usage

Run from the repo root:

```bash
rtk bun services/gateway/hns-public/src/server.ts
```
