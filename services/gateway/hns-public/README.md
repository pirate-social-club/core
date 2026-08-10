# HNS Public Gateway

This service is the VPS-facing web gateway for real `name.pirate` profile requests and `name.clawitzer` agent requests.

It is the server-side counterpart to Freedom's HNS browsing path:

- Freedom/browser resolves `blackbeard.pirate` or `night-signal.clawitzer`
- PowerDNS routes `*.pirate` and `*.clawitzer` to Pirate's VPS
- this gateway reads `Host`, resolves the profile through Pirate's public API, and renders the public profile HTML

## Responsibilities

- serve `GET /health`
- accept host-based `.pirate` requests
- map `<label>.pirate` -> `<label>.pirate` Pirate handle
- call `GET /public-profiles/:handle`
- render the same public profile surface used for the ICANN fallback
- accept host-based `.clawitzer` requests
- map `<label>.clawitzer` -> `<label>.clawitzer` Pirate agent handle
- call `GET /public-agents/:handle`
- render the same public agent surface used for the ICANN fallback
- redirect renamed handles to the current HNS host
- serve Caddy's loopback-only on-demand TLS permission check and authorize only
  hostnames backed by real first-party or verified namespace routes

## Environment

- `HNS_PUBLIC_GATEWAY_HOST`
- `HNS_PUBLIC_GATEWAY_PORT`
- `HNS_PUBLIC_GATEWAY_ROOT_SUFFIX`
- `HNS_PUBLIC_GATEWAY_AGENT_SUFFIX`
- `HNS_PUBLIC_GATEWAY_EXTERNAL_SCHEME`
- `HNS_PUBLIC_API_ORIGIN`
- `HNS_PUBLIC_APP_ORIGIN`
- `HNS_PUBLIC_FORWARDER_HMAC_KEY` (at least 32 random bytes; must match the
  Worker's `HNS_FORWARDER_HMAC_KEY` secret)
- `HNS_PUBLIC_FORWARDER_AUTH_TOKEN` (legacy rollout credential; configure it
  alongside the HMAC key only during the dual-emit compatibility window)
- `HNS_PUBLIC_NAMESPACE_RESOLVE_TIMEOUT_MS` (default `2000`)
- `HNS_PUBLIC_NAMESPACE_CACHE_TTL_MS` (default `30000`)
- `HNS_PUBLIC_NAMESPACE_CACHE_STALE_MS` (default `300000` after the fresh TTL)
- `HNS_PUBLIC_NAMESPACE_CACHE_MAX_ENTRIES` (default `2048`)
- `HNS_PUBLIC_CADDY_ASK_PORT` (always bound to `127.0.0.1`)
- `HNS_PUBLIC_CADDY_ASK_DB_PATH`
- `HNS_PUBLIC_CADDY_MAX_HOSTS_PER_NAMESPACE`

## Local Usage

Run from the repo root:

```bash
rtk bun services/gateway/hns-public/src/server.ts
```

## Video range capacity gate

Before launch, run the bounded range-load probe against the gateway path, not
the ICANN API origin. A loopback Caddy target can carry the reserved HNS host
explicitly:

```bash
rtk bun run --cwd services/gateway/hns-public load:video-ranges -- \
  --url http://127.0.0.1:8080/public-communities/<community>/song-artifact-uploads/<upload>/content \
  --host api.pirate \
  --object-bytes <video-size> \
  --requests 500 \
  --concurrency 25 \
  --range-bytes 1048576 \
  --disconnect-every 10 \
  --read-delay-ms 5
```

The probe requires `206` plus `Content-Range`, cycles across the declared
object size, slowly consumes ordinary responses to exercise backpressure, and
intentionally cancels every Nth response to exercise disconnect cleanup. It
exits nonzero on any unexpected status, empty range, timeout, or accounting
mismatch. Record throughput and p50/p95/p99 latency alongside gateway CPU,
memory, open sockets, and upstream errors; do not point it at production
without an approved load window.
