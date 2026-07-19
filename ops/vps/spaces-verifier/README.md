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
- `bin/stage-release-assets.sh`
  Downloads the immutable Spaces publisher `v0.1.3` Linux archive, verifies
  the pinned archive digest and the extracted binary digest independently,
  and stages the read-only Fabric reader plus its AGPL notice into the role
  release. `make-release.sh` covers the staged bytes in the role SHA256SUMS.
- `bin/check-verifier-health.sh` and the verifier-health systemd timer
  Check the specific `fabric_record_reader_ready` signal and the absence of
  native/fallback target disagreements every five minutes. A degraded,
  missing, or divergent signal fails the oneshot and invokes the existing
  authenticated ops-alert delivery path through `alert-on-failure.sh`.
- `config/published-targets.json`
  Availability backstop for 44 active Spaces communities whose live root key
  matched the key stored in their accepted `fabric_txt_publish` challenge on
  2026-07-19. Native Fabric records remain authoritative when present. The
  verifier applies a fallback only while the current proof key still matches,
  validates both targets as credential-free HTTPS URLs, and reports any
  observed native target disagreement through monitored health. Five active
  roots were excluded for key changes: `@christian`, `@xn--e77h5a`,
  `@xn--f77hma`, `@xn--i77hd`, and `@xn--x77hga`.

The systemd template intentionally runs `bun` directly, not `rtk`. `rtk` is a local CLI
convenience, not a VPS runtime dependency.

The authoritative HNS DNS assets live in the sibling
[ops/vps/hns-authoritative-dns](../hns-authoritative-dns/README.md) directory.
