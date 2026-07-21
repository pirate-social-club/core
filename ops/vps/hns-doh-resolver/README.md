# HNS DoH resolver

Pirate-operated recursive Handshake resolver, exposed as DNS-over-HTTPS at
`https://dns.pirate.sc/dns-query`.

## Why this exists

Freedom Browser resolves HNS **port-53-first**: local hnsd recurses to the
authoritative nameservers on `:53`, and only falls back to DoH if that fails. Its
only DoH fallbacks are `na.hnsdoh.com` and `hnsdoh.com`
(`freedom-browser/src/main/hns-doh-resolver.js`). On 2026-07-21 both returned
502/500 while `.pirate` infrastructure was fully healthy, which took out HNS
browsing on any network that blocks `:53` — a third-party single point of failure
in front of our own names.

This role removes that dependency and makes every correctly-delegated HNS TLD
resolvable over 443.

## ⚠️ This is an availability service, not a trust service

Freedom does **not** validate what a DoH resolver returns. It requests only
`A`/`AAAA`/`CNAME`, never sets the EDNS DO bit, and never fetches `TLSA`; the
returned address is used directly. So for Freedom, pointing at this endpoint
replaces "trust hnsdoh.com" with "trust Pirate" — it does **not** restore an
end-to-end DNSSEC/DANE trust model.

Label it accordingly wherever it is surfaced to users. The real fix is
client-side verification in Freedom (validate the Handshake proof, the delegated
DNSSEC chain, and DANE/TLSA before connecting); that is separate work and this
role does not substitute for it.

Clients that *do* validate locally (e.g. Denuo) get both availability and trust
from this endpoint, because their verification is unaffected by which transport
delivered the answer.

## Shape

```
client ──HTTPS──► Caddy :443 (dns.pirate.sc, Let's Encrypt / WebPKI)
                    │ reverse_proxy /dns-query
                    ▼
                 dnsdist 127.0.0.1:8053  (cleartext DoH, rate limits, cache)
                    ▼
                 hnsd    127.0.0.1:5350  (SPV recursive resolver)
```

Design constraints, all load-bearing:

- **The endpoint hostname must be ICANN-resolvable and use a WebPKI cert.** A
  client cannot reach a `.pirate` name or validate a DANE-only cert *before* it
  has a working HNS resolver. Hence `dns.pirate.sc`, not `dns.pirate`.
- **Authoritative and recursive stay separate.** PowerDNS authoritative owns
  `94.103.168.161:53`. hnsd is loopback-only. Mixing the two roles on one address
  is a cache-poisoning footgun, and `127.0.0.1:53` is already taken by PowerDNS —
  hence port 5350.
- **No public UDP recursion.** DoH is TCP, so there is no amplification vector.
  Never expose hnsd's `:5350` publicly to "make it easier to test".
- **Separate failure domain from the verifier.** This does not enable recursion
  on the `hns-chain-observer` hsd node; that node backs namespace verification
  and must not share a failure domain with an abusable public service.

## Deploy

```sh
cd ops/vps/hns-doh-resolver
# The container runs as uid 1000 and cannot write a root-owned bind mount.
mkdir -p data && sudo chown 1000:1000 data
docker compose build
docker compose up -d
```

Then add the Caddy site (Caddy already manages certs on this host):

```
dns.pirate.sc {
	handle /dns-query* {
		reverse_proxy 127.0.0.1:8053
	}
	handle {
		respond "Pirate HNS DoH resolver" 200
	}
}
```

Prerequisite: `dns.pirate.sc` A → `94.103.168.161` in ICANN DNS, before Caddy can
complete the ACME challenge.

## Verify

```sh
# a non-Pirate HNS TLD proves real recursion, not just our own zone
curl -H 'accept: application/dns-message' \
  'https://dns.pirate.sc/dns-query?dns=<base64url wire query for g>' | xxd | head

# our own name
dig @127.0.0.1 -p 5350 app.pirate A
```

Acceptance: `g`, `app.pirate`, a signed delegation, an unsigned delegation,
NXDOMAIN, and DNSSEC record types all resolve; oversized/truncated responses fall
back to TCP correctly; the per-IP rate limit actually refuses.

## Operational notes

- The resolver sees which HNS names users visit. `dnsdist.conf` deliberately
  enables no query log and no API/console. Keep it that way.
- hnsd is SPV, so `data/` stays small and is disposable — this matters on a host
  at ~74% disk. But a **first** boot from an empty `data/` syncs from genesis and
  takes roughly 40 minutes (measured ~4k blocks/30s) before the resolver answers
  anything. Restarts resume from `data/` and are fast. Do not interpret an
  unhealthy container during initial sync as a failure.
- DoT on `:853` is intentionally **not** in v1. It would require distributing and
  renewing a cert into dnsdist alongside Caddy's; 443 already covers the
  port-53-blocked case that motivated this work.
