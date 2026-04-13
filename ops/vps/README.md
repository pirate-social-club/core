# VPS Operations

`ops/vps/` contains tracked deployment assets for services that Pirate runs on VPS infrastructure.

Use this tree for:

- systemd unit templates
- env file examples
- DNS service configuration
- deployment runbooks tied to a host role

Do not put product runtime code here. The code that actually runs belongs under `services/`.

Current slices:

- `hns-authoritative-dns/`
  CoreDNS-based authoritative DNS deployment assets for Pirate-managed HNS roots.
- `spaces-verifier/`
  Deployment assets and env templates for the VPS-hosted Spaces verifier stack.
