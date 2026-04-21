# HNS Public Gateway VPS Assets

This directory contains tracked deployment assets for the VPS-hosted `.pirate` and `.clawitzer` public profile gateway.

Use it together with the runtime code in
[services/gateway/hns-public](../../../services/gateway/hns-public/README.md).

## Scope

This service is the HTTP origin that receives wildcard `*.pirate` and `*.clawitzer` traffic after PowerDNS
routes those hosts to Pirate's VPS.

It should:

- accept requests for `https://<label>.pirate` and `https://<label>.clawitzer`
- preserve the incoming `Host` header
- resolve the matching Pirate profile or agent through the public API
- render the public profile or agent HTML directly

Recommended deploy root:

- `/srv/pirate-hns/app`
- `/srv/pirate-hns/config`

## Files

- `env/hns-public-gateway.env.example`
- `systemd/pirate-hns-public-gateway.service`
- `nginx/hns-public-gateway.conf.example`

The systemd template intentionally runs `bun` directly, not `rtk`.
