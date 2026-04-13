# Spaces Verifier VPS Assets

This directory contains tracked deployment assets for the VPS-hosted Spaces verification slice.

Use it together with the runtime code in
[services/verifier/spaces](../../../services/verifier/spaces/README.md).

## Scope

This VPS slice may share a machine with the HNS DNS stack, but it remains operationally separate:

- separate Unix user
- separate deploy root
- separate env files
- separate systemd unit
- separate logs and runtime data

## Files

- `env/verifier.env.example`
  Example verifier runtime environment.
- `env/spaced.env.example`
  Example `spaced` environment contract.
- `systemd/pirate-spaces-verifier.service`
  Tracked verifier systemd unit template.

The authoritative HNS DNS assets live in the sibling
[ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md) directory.
