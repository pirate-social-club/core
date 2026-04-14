# Spaces Operator Signing Contract

Status: required to make the public-v0 Spaces verification flow operator-usable end to end

Related:

- [docs/operators/spaces-verification-runtime-contract.md](./spaces-verification-runtime-contract.md)
- [specs/domain/spaces-verification-flow.md](../../specs/domain/spaces-verification-flow.md)
- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)
- [pirate-web/src/components/compositions/create-community-composer/create-community-composer.tsx](../../pirate-web/src/components/compositions/create-community-composer/create-community-composer.tsx)

## Problem

Pirate's Spaces verification flow is implemented on the Pirate side:

- Pirate issues a session-bound challenge message and digest
- Pirate verifies a compact Schnorr signature against the root pubkey derived from live Spaces proof data
- Pirate can issue `namespace_verification_id` after successful verification

The missing operator-side primitive is a way to sign Pirate's raw challenge digest with the current
top-level `@space` root key.

Current local findings:

- `spaced` exposes proof and read methods such as `getspace`, `getrootanchors`, and `provespaceoutpoint`
- `spaced` does not expose `signmessage`, `signdigest`, `signschnorr`, or `signchallenge`
- `space-cli` exposes `signevent` and `signzone`, but those wrap signing in Nostr-oriented payload
  formats rather than returning a raw Schnorr signature for an arbitrary Pirate digest

That means the Pirate flow is wired but still blocked for a normal operator.

## Local Helper Available In Pirate

This repo now includes a local operator helper that performs the missing raw-digest signing step
without requiring upstream `scli` changes first:

```bash
rtk bun services/verifier/spaces/scripts/sign-digest.ts \
  --space @pirate \
  --digest <challenge_digest_hex> \
  --rpc-url http://127.0.0.1:7225 \
  --rpc-cookie /path/to/.cookie \
  --spaces-data-dir /path/to/spaced-data \
  --wallet default \
  --network mainnet
```

Behavior:

- resolves the current owner outpoint for the requested root over spaced RPC
- loads the existing local wallet DB from `<spaced-data>/<network>/wallets/<wallet>`
- derives the owned taproot keypair for that outpoint
- signs the exact 32-byte digest Pirate issued
- returns JSON with `signature` and `pubkey`

This closes the operator flow for local/dev use, but it is still not the public CLI surface that
normal Spaces operators should be expected to discover or maintain manually.

## Pirate Requirement

Pirate currently expects the operator to produce a raw compact Schnorr signature over the digest in
the Spaces challenge payload.

Current challenge payload fields:

- `message`
- `digest`
- `algorithm = bip340_schnorr`
- `domain = pirate-spaces-verification`
- `issued_at`
- `expires_at`
- `root_label`

Current completion payload fields:

- `signature`
- optional `algorithm`
- optional `signer_pubkey`
- optional `digest`

The backend falls back to the stored digest if the client omits `digest`, but the signer must still
have signed that same value.

## Required CLI Surface

The preferred operator interface is a first-class `scli` command:

```bash
./scli signdigest @pirate <hex_digest>
```

Required behavior:

- use the current root private key for the specified top-level `@space`
- accept exactly one 32-byte digest encoded as lowercase hex
- return the compact signature as lowercase hex
- fail closed when the wallet does not control the current root key
- fail closed when the space is not a top-level owned root

Recommended response shape:

```json
{
  "space": "@pirate",
  "algorithm": "bip340_schnorr",
  "digest": "<hex_digest>",
  "signature": "<64-byte-signature-hex>",
  "pubkey": "<x-only-pubkey-hex>"
}
```

Text output is acceptable for operators, but JSON output should also exist for automation.

## Required RPC Surface

The CLI should have an RPC equivalent so Pirate-adjacent tooling can automate local operator flows.

Recommended RPC method:

```text
signdigest
```

Recommended params:

```json
["@pirate", "<hex_digest>"]
```

Recommended result:

```json
{
  "space": "@pirate",
  "algorithm": "bip340_schnorr",
  "digest": "<hex_digest>",
  "signature": "<64-byte-signature-hex>",
  "pubkey": "<x-only-pubkey-hex>"
}
```

## Non-Goals

Do not make Pirate parse or accept:

- Nostr event signatures as the primary Spaces verification artifact
- zone-signature envelopes
- ad hoc wallet-export flows

Those may use the same key material internally, but they change the proof contract and add
unnecessary encoding rules to Pirate's verifier boundary.

## Why Not Reuse `signevent`

`signevent` signs a Nostr event, not Pirate's raw session digest.

That means:

- the operator must serialize a Nostr event first
- the signed value becomes the NIP-01 event id, not Pirate's digest directly
- Pirate would need to verify event-shape conventions in addition to root-key control

That is a worse boundary than direct raw-digest signing.

## Operator UX Target

The intended public-v0 operator flow should be:

1. Pirate shows the root, message, and digest.
2. Operator runs:

```bash
./scli signdigest @pirate <digest>
```

Current repo-local equivalent:

```bash
rtk bun services/verifier/spaces/scripts/sign-digest.ts --space @pirate --digest <digest> ...
```

3. Operator pastes the returned signature into Pirate.
4. Pirate completes verification and issues `namespace_verification_id`.

This keeps the operator ceremony legible and keeps Pirate's verifier contract small.
