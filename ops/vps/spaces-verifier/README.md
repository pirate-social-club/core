# Spaces Verifier VPS Assets

Status: **PUBLIC CUTOVER COMPLETE (2026-07-18)**. The verification-only daemon
and verifier remain loopback-only on ns1 behind Caddy. Public WebPKI health,
proof-verified `@pirate` resolution, and authenticated inspection were proven
through `https://verifier.pirate.sc/spaces`. See the dated
[HNS/Spaces handoff](../../../docs/operators/hns-spaces/README.md).

This directory contains tracked deployment assets for the VPS-hosted Spaces verification slice.

Use it together with the runtime code in
[services/verifier/spaces](../../../services/verifier/spaces/README.md).

Deployment assumption:

- the VPS keeps a full `core` checkout at `/srv/pirate-spaces/app`
- deployment must preserve the repo tree under `services/` and `ops/`
- do not flatten the verifier files into ad hoc top-level paths such as `scripts/spaces-verifier.ts`

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
- `systemd/pirate-spaced.service`
  Verification-only, loopback-bound Spaces daemon. This is distinct from the
  blocked issuance-side `protocol-spaced` role.
- `bin/build-spaced.sh`
  Builds `spaced` from the exact Spaces source commit used by the native
  verifier dependencies and installs a commit-named binary.
- `bin/start-spaced.sh`
  Fails closed on missing RPC/auth configuration and binds RPC to loopback.

The systemd template intentionally runs `bun` directly, not `rtk`. `rtk` is a local CLI
convenience, not a VPS runtime dependency.

The authoritative HNS DNS assets live in the sibling
[ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md) directory.
