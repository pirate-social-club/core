# Verifier Services

`services/verifier/` holds long-running verifier runtimes that Pirate owns as application services.

Use this tree for code that executes business-level verification logic outside the Cloudflare worker,
such as VPS-hosted sidecars or dedicated verification daemons.

Boundary:

- `services/api/`
  Cloudflare-facing request handling and verification state machines.
- `services/verifier/`
  Runtime code for verifier processes that Pirate deploys and operates elsewhere.
- `ops/vps/`
  Machine-specific deployment assets for those verifier services.

Current services:

- `hns/`
  PowerDNS-backed HNS verifier and zone-provisioning sidecar.
- `spaces/`
  Spaces verifier sidecar, native helper crate, and operator signing helper.
