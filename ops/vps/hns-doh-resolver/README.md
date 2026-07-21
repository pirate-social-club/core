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

- **dnsdist's ACL must be opened explicitly.** Its default is loopback plus
  RFC1918, and because `trustForwardedForHeader` is set the ACL is evaluated
  against the *forwarded client* address rather than Caddy's loopback address.
  The loopback path therefore works while every real client gets
  `DoH query not allowed because of ACL`. Rate limits and rejected query types are
  what keep this service safe, not the ACL.
- **Caddy must reach dnsdist over h2c.** dnsdist's cleartext DoH listener speaks
  HTTP/2 only; an HTTP/1.1 request to it gets no usable response at all. The
  route therefore sets `transport.versions` to `["h2c", "2"]`. Verified on the
  box: HTTP/1.1 returns nothing, h2c returns a valid DNS answer.
- **A new hostname needs its own TLS connection policy.** This host ends its
  `tls_connection_policies` with a catch-all selecting the self-signed DANE
  gateway certificate, so a hostname without an SNI-matched policy inherits that
  instead of an ACME certificate. `install-caddy-route.sh` adds one.
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

Deploy as an immutable release, the same way the other VPS roles do. **Never edit
files under `/srv/pirate-hns-doh/current/`** -- it is a release directory covered
by a `SHA256SUMS` manifest, and hand-editing it makes
`pirate-deployment-verify@doh` fail permanently with `release checksum mismatch`.

Order matters: the public health timer must not be enabled until the endpoint it
probes actually exists, or it pages continuously through first sync and through
ACME issuance.

```sh
# --- on your workstation, from the repo root, on a CLEAN checkout ---
# make-release.sh refuses a dirty tree; deployments must map to exact commits.
bash ops/vps/deployment-tooling/make-release.sh ops/vps/hns-doh-resolver /tmp/doh-out \
  --expect-running true --monitored-container pirate-dnsdist-doh
# prints: release staged: /tmp/doh-out/releases/<core-sha>
CORE_SHA="$(basename /tmp/doh-out/releases/*)"

tar -czf /tmp/doh-release.tgz -C /tmp/doh-out/releases "$CORE_SHA"
scp /tmp/doh-release.tgz ubuntu@94.103.168.161:/tmp/
scp ops/vps/hns-doh-resolver/env/*.example ubuntu@94.103.168.161:/tmp/
scp ops/vps/hns-doh-resolver/systemd/* ubuntu@94.103.168.161:/tmp/

# --- on the host ---
CORE_SHA=<paste from above>

# Config and persistent state live OUTSIDE releases, so a release swap or a
# rollback cannot destroy them. The container runs as uid 1000.
sudo mkdir -p /srv/pirate-hns-doh/{releases,shared/data,config}
sudo chown 1000:1000 /srv/pirate-hns-doh/shared/data
sudo cp /tmp/doh-health.env.example /srv/pirate-hns-doh/config/doh-health.env
sudo cp /tmp/resolver.env.example   /srv/pirate-hns-doh/config/resolver.env

# Unpack, verify the manifest BEFORE flipping, then flip.
sudo tar -xzf /tmp/doh-release.tgz -C /srv/pirate-hns-doh/releases/
(cd "/srv/pirate-hns-doh/releases/$CORE_SHA" && sudo sha256sum --check SHA256SUMS)
sudo ln -sfn "releases/$CORE_SHA" /srv/pirate-hns-doh/current
# rollback at any point = sudo ln -sfn releases/<previous-sha> /srv/pirate-hns-doh/current

sudo cp /tmp/pirate-hns-doh-*.service /tmp/pirate-hns-doh-*.timer /etc/systemd/system/
sudo systemctl daemon-reload

# Start the resolver and WAIT. First boot from empty state syncs hnsd from
# genesis (~40 min); the unit stays "activating" until the Hesiod sync gate
# passes rather than reporting active while the resolver returns nothing.
sudo systemctl enable --now pirate-hns-doh-resolver.service
sudo systemctl enable --now pirate-deployment-verify@doh.timer
```

The resolver unit pins the Compose project name to `pirate-hns-doh`. This is
required because `current` resolves to a commit-named release directory;
allowing Compose to derive its project name from that directory would make
every release a new project, prevent `down` from finding the old containers,
and make `up` collide with their explicit container names.

Now install the Caddy route (below), run the acceptance suite, and only then
enable the public health timer:

```sh
sudo systemctl enable --now pirate-hns-doh-health.timer
```

Then install the Caddy route:

```sh
./install-caddy-route.sh
```

**The live unit runs `pirate-caddy run --config /etc/caddy/caddy.json`, so editing
`/etc/caddy/Caddyfile` deploys nothing.** `install-caddy-route.sh` patches the JSON
that is actually loaded, using `caddy-route.json` as the fragment: it backs up the
current config, validates with the same custom binary, reloads, smoke-tests, and
restores the backup if the reload fails. It is idempotent.

If the reload succeeds but the HTTPS smoke test does not, the installer **leaves
the new config installed** and exits non-zero. That is deliberate: the usual
cause is ACME still issuing for a brand-new hostname, and the change is scoped to
`dns.pirate.sc`, so rolling back would only delay issuance. The backup path is
printed either way.

### Prerequisite: the DNS record must be DNS-only

```
dns.pirate.sc  A  94.103.168.161     Cloudflare proxy: DNS only (grey cloud)
```

Required before Caddy can complete the ACME challenge — and the **grey cloud is
load-bearing**, not a preference. Proxied (orange cloud) would:

- put Cloudflare in a position to observe every resolver query, which is exactly
  the exposure this service exists to reduce;
- make Caddy's network peer Cloudflare rather than the client. dnsdist takes the
  **right-most** `X-Forwarded-For` address for rules and logging, so the per-IP
  QPS limit would bucket many unrelated users under one Cloudflare edge address
  and throttle them collectively.

The direct topology is safe because Caddy appends the real peer address. If this
ever moves behind another proxy, `trustForwardedForHeader` in `dnsdist.conf` must
be revisited and an explicit trusted-proxy chain configured and tested.

## Verify

```sh
./acceptance.sh --endpoint https://dns.pirate.sc/dns-query
```

Exercises the real path (DoH client → Caddy → dnsdist → hnsd) in both GET and
POST form and checks: content-type, request-id preservation, A/TLSA/DNSKEY with
the DO bit, the `*.pirate` wildcard, an external HNS TLD (real recursion, not
just our own zone), a delegated-but-unserved name, NXDOMAIN in an external zone
without the `*.pirate` wildcard, AXFR/IXFR/ANY rejection, and malformed-payload
rejection. Positive checks require real answer
records (NOERROR with `ancount=0` fails), not merely a NOERROR rcode. Non-zero
exit on any required failure; third-party-dependent checks are advisory.

Rate-limit identity under a spoofed `X-Forwarded-For` is **not** covered by the
suite — one request returning 200 proves nothing about which address dnsdist
attributed it to, and proving it properly means driving the limit past its
threshold. Verify it as a controlled observation instead: run dnsdist with a
temporary low-QPS test policy and confirm that rotating attacker-supplied
left-side XFF values cannot evade a limit bound to the real right-most peer.

Resolver-local spot check:

```sh
dig @127.0.0.1 -p 5350 app.pirate A
dig @127.0.0.1 -p 5351 -c HS -t TXT synced.chain.hnsd +short   # "true" when synced
```

## Lifecycle and monitoring

| unit | purpose |
|---|---|
| `pirate-hns-doh-resolver.service` | brings the compose stack up from `current/`, waits for the hnsd sync gate |
| `pirate-hns-doh-health.{service,timer}` | probes the **public** endpoint every 15m via `bin/check-doh-health.sh`; `Requires=`/`After=` the resolver, and skips while it is still activating |
| `pirate-hns-doh-health-alert.service` | `OnFailure=` webhook for the above |
| `pirate-deployment-verify@doh.{service,timer}` | release/manifest/image-digest drift + heartbeat |

The health check deliberately probes `https://dns.pirate.sc/dns-query` rather than
a loopback backend: a container-level check stays green while the published
service is unreachable. It requires `rcode=0` **and** `ancount > 0`, so a resolver
answering NOERROR-with-no-data fails. It retries 3x with backoff, matching the
authoritative monitors, so one dropped packet does not page anyone.

The health unit `Requires=` and is ordered `After=` the resolver unit, and its
`ExecStart` exits 0 while the resolver is still `activating`. Without that, a
first boot would page every 15 minutes for the ~40 minutes hnsd spends syncing
from genesis, and again for as long as ACME had not yet issued for
`dns.pirate.sc`. A resolver that is *active but not answering* still fails --
that is the state worth paging on. The timer's `OnBootSec` is 45m for the same
reason.

Drift verification needs `/etc/pirate-deployment-verify/doh.env` with
`DEPLOY_ROOT=/srv/pirate-hns-doh` plus the shared alert webhook settings.

Note: `DEPLOYMENT` metadata tracks a single container, named explicitly via
`--monitored-container pirate-dnsdist-doh` (digest-pinned and public-facing).
`make-release.sh` refuses to guess for a multi-service role. hnsd is built locally
and has no digest to verify; it is covered by its own container healthcheck and by
the end-to-end probe.

## Operational notes

- The resolver sees which HNS names users visit. `dnsdist.conf` deliberately
  enables no query log and no API/console. Keep it that way.
- **Caddy access logging must stay disabled on this host** (it currently is).
  GET-form DoH carries the whole query in `?dns=...`, so an access log — or a
  proxy *error* log that includes the request URI — reconstructs user browsing
  even though dnsdist logs nothing. If logging is ever enabled, redact the `dns`
  query parameter. Prefer POST in clients we control.
- State lives at `/srv/pirate-hns-doh/shared/data` (override with `HNSD_DATA_DIR`),
  deliberately outside the checkout so a release swap or worktree cleanup cannot
  destroy it. Losing it is a ~40 minute resync outage, not a scratch directory.
- hnsd is SPV, so the data dir stays small — this matters on a host at ~74% disk.
  It is **reconstructible availability state**, not scratch: it can be rebuilt from
  the network, but losing it costs a ~40 minute outage. But a **first** boot from empty state syncs from genesis and
  takes roughly 40 minutes (measured ~4k blocks/30s) before the resolver answers
  anything. Restarts resume from `data/` and are fast. Do not interpret an
  unhealthy container during initial sync as a failure. Note that an unhealthy
  container is *not* restarted by `restart: unless-stopped`; `start_period` is
  startup tolerance, and the Hesiod `synced` + tip-age probe is the actual gate.
- DoT on `:853` is intentionally **not** in v1. It would require distributing and
  renewing a cert into dnsdist alongside Caddy's; 443 already covers the
  port-53-blocked case that motivated this work.
