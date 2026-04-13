# Spaces Verifier Service

This service hosts the Pirate-managed Spaces verification runtime that runs on a VPS rather than in
the Cloudflare worker.

## Layout

- `src/server.ts`
  HTTP sidecar for `GET /inspect`, `POST /verify-signature`, and related verifier endpoints.
- `scripts/sign-digest.ts`
  Operator helper for signing a Pirate-issued digest with the current `@space` root key.
- `native/`
  Rust crate for proof inspection and Schnorr signature verification.
- `vendor/spacedb/`
  Vendored upstream dependency snapshot pinned to the native crate expectations.

## Ownership Boundary

Keep protocol-facing verifier code here.

Do not put VPS-specific deployment files, hostnames, systemd units, or env secrets here. Those live
under `ops/vps/`.

## Local Usage

Run the HTTP verifier from the repo root:

```bash
rtk bun services/verifier/spaces/src/server.ts
```

Run the operator signing helper from the repo root:

```bash
rtk bun services/verifier/spaces/scripts/sign-digest.ts --space @pirate --digest <hex>
```

The native crate still builds the `spaces-verifier-native` binary, and
`SPACES_VERIFIER_NATIVE_BIN` should point at that compiled artifact.

For production-style runs, point `SPACES_VERIFIER_NATIVE_BIN` at a prebuilt binary. Keep
`SPACES_NATIVE_ALLOW_BUILD_FALLBACK` reserved for local development.
