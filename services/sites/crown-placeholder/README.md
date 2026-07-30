# Crown placeholder

An asset-only Cloudflare Worker origin for a DANE-fronted Handshake static
site. The public HNS hostname should terminate TLS on Pirate's VPS and proxy to
this Worker; do not attach the HNS hostname as a Cloudflare custom domain.

## Customize

Replace the `data-simplex-link` anchor URL in `public/index.html` with the real
SimpleX invite URL before production promotion.

## Deploy

```bash
bun install
bun run deploy:dry
bun run deploy
```

The deployment produces a stable `pirate-crown-placeholder.<account>.workers.dev`
origin. Configure the VPS gateway to fetch that hostname while preserving the
visitor-facing HNS URL.

## DANE topology

```text
browser -> DNSSEC PowerDNS zone -> TLSA 3 1 1
        -> VPS Caddy shared DANE certificate
        -> pirate-crown-placeholder.<account>.workers.dev
```

The VPS certificate SPKI, not Cloudflare's rotating edge certificate, is the
TLSA association. Use the canonical two-phase tooling under
`ops/vps/hns-authoritative-dns/manage-tlsa.ts`; never change the served key and
TLSA RRset in one step.
