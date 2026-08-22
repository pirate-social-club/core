# Crown placeholder

An asset-only Cloudflare Worker origin for a DANE-fronted Handshake static
site. The public HNS hostname should terminate TLS on Pirate's VPS and proxy to
this Worker; do not attach the HNS hostname as a Cloudflare custom domain.

## Add a parked domain

Add its presentation to the `sites` map in `public/index.html`, deploy this
shared origin, then add an exact hostname mapping to
`HNS_PUBLIC_STATIC_SITE_ROUTES` on the VPS gateway. The page selects its title,
message, symbol, and colors from the visitor-facing hostname while sharing the
same SimpleX invite and Cloudflare deployment.

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
