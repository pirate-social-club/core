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
  PowerDNS-based authoritative DNS deployment assets for Pirate-managed HNS roots.
- `hns-secondary-dns/`
  Independent PowerDNS secondary with signed-NOTIFY autoprovisioning and TSIG-authenticated AXFR.
- `hns-verifier/`
  Deployment assets and env templates for the PowerDNS-backed HNS verifier/provisioner.
- `hns-chain-observer/`
  Keyless mainnet `hsd` node used for authenticated root-expiry observation and
  post-acceptance revalidation. The tracked deployment is release/digest pinned,
  pruned, loopback-only, and contains no wallet or DNS-serving role.
- `spaces-verifier/`
  Deployment assets and env templates for the VPS-hosted Spaces verifier stack.
