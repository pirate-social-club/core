# HNS Public Gateway VPS Assets

This directory contains tracked deployment assets for the VPS-hosted `.pirate`, `.clawitzer`, and verified community-root gateway.

Use it together with the runtime code in
[services/gateway/hns-public](../../../services/gateway/hns-public/README.md).

## Scope

This service is the HTTP origin that receives wildcard `*.pirate` and `*.clawitzer` traffic after PowerDNS
routes those hosts to Pirate's VPS.

`app.pirate` is not part of this public-profile gateway. It is the main Pirate web app host and
should route to the app origin before wildcard profile routing is evaluated.
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

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-public-gateway.env.example`
- `systemd/pirate-hns-public-gateway.service`
- `caddy/Caddyfile.example`
- `nginx/hns-public-gateway.conf.example`

The systemd template intentionally runs `bun` directly, not `rtk`.
