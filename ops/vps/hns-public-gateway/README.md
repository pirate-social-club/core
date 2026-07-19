# HNS Public Gateway VPS Assets

This directory contains tracked deployment assets for the VPS-hosted `.pirate`, `.clawitzer`, and verified community-root gateway.

Use it together with the runtime code in
[services/gateway/hns-public](../../../services/gateway/hns-public/README.md).

## Scope

This service is the HTTP origin that receives wildcard `*.pirate` and `*.clawitzer` traffic after PowerDNS
routes those hosts to Pirate's VPS.

`app.pirate` routes to the main Pirate web app before wildcard profile routing
is evaluated. The bare `pirate.` apex permanently redirects to the same path
and query on `app.pirate`; sessions must not use the single-label apex.
`api.pirate` is also reserved for API traffic and should route before wildcard profile routing.
When these hosts proxy to the Cloudflare `.sc` runtime, forward `X-Pirate-HNS-Host` so SSR can
derive app/API/canonical metadata from the HNS entrypoint after validating the forwarder IP.

It should:

- accept requests for `https://<label>.pirate` and `https://<label>.clawitzer`
- preserve the incoming `Host` header
- resolve the matching Pirate profile or agent through the public API
- render the public profile or agent HTML directly
- authorize Caddy certificate issuance on `127.0.0.1:4050` only for explicit
  first-party services, existing profiles/agents, or currently routable
  verified community namespaces

## On-demand TLS safety

The Caddy catchall must not enable `on_demand` without the global
`on_demand_tls` `ask` endpoint in the committed example. Otherwise arbitrary
SNI values can mint local-CA certificates and consume storage.

The ask listener is a separate socket hard-bound by the gateway to
`127.0.0.1`. Do not publish or reverse-proxy port `4050`. It fails closed when
the Pirate API is unavailable and relies on `GET /public-namespaces/:root`
continuing to expose only active, verified, authority-healthy namespaces with
web routing enabled.

For community roots, authorization grants are stored in
`/var/lib/pirate-hns/caddy-ask.sqlite` and capped per namespace-verification id
(64 hostnames by default). This bounds storage even when an attacker sends
invented subdomain SNI values under a real verified root. Existing grants remain
renewable at the cap. A new verification id is treated as a new ownership epoch:
the new owner receives a fresh quota, while inactive prior-epoch grants remain
recorded but cannot authorize issuance because the API no longer returns their
verification id.

Dedicated deploy root:

- `/srv/pirate-hns-gateway/app`
- `/srv/pirate-hns-gateway/config`

Do not reuse `/srv/pirate-hns`: the state-backup role owns that immutable
release root and has an independent app pin and rollback lifecycle.

## Files

- `env/hns-public-gateway.env.example`
- `systemd/pirate-hns-public-gateway.service`
- `caddy/Caddyfile.example`
- `caddy/Caddyfile.dane.example`
- `caddy/Caddyfile.production.example` (preserves the live WebPKI verifier
  origin while adding the DANE catchall)
- `caddy/build-production-config.sh` (adapts that combined Caddyfile to native
  JSON with separate, ordered WebPKI and DANE TLS handshake policies)
- `systemd/caddy-production-json.override.conf` (makes the native production
  config path explicit; a file named `Caddyfile` is always adapted as text)
- `nginx/hns-public-gateway.conf.example`

The systemd template intentionally runs `bun` directly, not `rtk`.

## Public DNSSEC + DANE mode

`caddy/Caddyfile.dane.example` is the canonical public HNS HTTPS mode. It loads
one deliberately managed certificate/key for the catchall gateway. All signed
zones publish the certificate's SPKI digest as `TLSA 3 1 1` through the
authoritative-DNS rollover tool.

This shared certificate is intentional. Under DANE-EE, the DNSSEC TLSA binding
is the service identity and RFC 7671 does not apply certificate-name matching.
It lets one gateway certificate serve arbitrary verified roots without a
per-host certificate/TLSA race.

The existing `Caddyfile.example` remains useful only where clients already
trust Caddy's private CA. Its on-demand certificates have distinct keys and
must not be described as matching one wildcard DANE-EE association.

The combined production Caddyfile must not be loaded directly. Caddy pools its
managed and manually loaded certificates, and the Caddyfile adapter otherwise
emits one unscoped policy that selects the static DANE certificate even for
`verifier.pirate.sc`. Build and install the native JSON config instead:

```bash
CADDY_BIN=/usr/local/bin/pirate-caddy \
  ops/vps/hns-public-gateway/caddy/build-production-config.sh \
  ops/vps/hns-public-gateway/caddy/Caddyfile.production.example \
  /etc/caddy/caddy.json
caddy reload --config /etc/caddy/caddy.json
```

Install the tracked systemd override before the first reload, then run
`systemctl daemon-reload`. The override deliberately retains the custom Caddy
binary that supplies `rate_limit`; the distribution `/usr/bin/caddy` does not
contain that module.

The builder fails closed unless the adapted input contains exactly the expected
tagged catchall policy. The resulting first policy matches
`verifier.pirate.sc` and performs normal SNI certificate selection; the second
policy selects the pinned DANE certificate for every other SNI.

Generate the initial key and certificate in a root-owned, versioned directory.
The Caddy config reads both through one `current` symlink so a rotation cannot
briefly pair a new certificate with an old private key:

```bash
install -d -o root -g caddy -m 0750 /etc/caddy/hns-dane/v1
umask 077
openssl ecparam -name prime256v1 -genkey -noout -out /etc/caddy/hns-dane/v1/key.pem
openssl req -new -x509 -sha256 -days 397 \
  -key /etc/caddy/hns-dane/v1/key.pem \
  -out /etc/caddy/hns-dane/v1/cert.pem \
  -subj '/CN=Pirate HNS DANE gateway'
chown root:caddy /etc/caddy/hns-dane/v1/key.pem /etc/caddy/hns-dane/v1/cert.pem
chmod 0640 /etc/caddy/hns-dane/v1/key.pem
chmod 0644 /etc/caddy/hns-dane/v1/cert.pem
ln -s v1 /etc/caddy/hns-dane/current
```

These ownership examples assume the packaged Linux service runs as user/group
`caddy`. For a container or a different service account, grant only that
runtime group read/traverse access; never make the private key world-readable.

Do not reload Caddy with a new key until `manage-tlsa.ts ready` succeeds. After
`ready`, create `current.next` pointing to the complete next version and rename
it over `current` in one filesystem operation before reloading Caddy. After the
reload, `manage-tlsa.ts retire` connects to the edge IP with an explicit SNI
name and refuses to remove the old association unless the served leaf SPKI
matches the prepared next certificate.
