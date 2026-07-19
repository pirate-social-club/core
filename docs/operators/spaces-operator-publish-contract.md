# Spaces Operator Publish Contract

Status: current public-v0 Spaces verification contract

Related:

- [docs/operators/spaces-repository-map.md](./spaces-repository-map.md)
- [docs/operators/spaces-verification-runtime-contract.md](./spaces-verification-runtime-contract.md)
- [specs/domain/spaces-verification-flow.md](../../specs/domain/spaces-verification-flow.md)
- [services/verifier/spaces/src/server.ts](../../services/verifier/spaces/src/server.ts)
- [tools/spaces-publisher/README.md](../../tools/spaces-publisher/README.md)

## Goal

Pirate verifies a Space by checking that the operator can publish session-bound Fabric TXT data for
the current root. The publish also routes the Space to the Pirate community URL.

This replaces the older raw challenge-signature flow. A separate signature upload is not part of the
Spaces flow.

## Operator Flow

Pirate shows one preflight command and one publish command:

```bash
go version
```

If Go is not installed, the operator installs it from https://go.dev/dl/ and reopens Terminal.

```bash
go run github.com/pirate-social-club/pirate-spaces-publisher@v0.1.5 publish @pirate \
  --wallet-export /path/to/wallet-export.json \
  --web https://pirate.sc/c/@pirate \
  --freedom https://pirate.sc/c/@pirate \
  --txt pirate-verify=pirate-space-verify=<session-id>:<nonce> \
  --signed-message-out /path/to/signed-publications/@pirate-<session-id>.fabric-message
```

After the publish succeeds, the operator clicks **Check setup** in Pirate.

For nontechnical operators, the wallet export and signed-publication paths should be local paths
copied or dragged into Terminal. The wallet export must not be uploaded to Pirate. The signed
publication contains public signed data, not wallet secrets; retain it durably so it can be
rebroadcast without reopening or copying the wallet.

## Published Records

The publish must set all of these values for the canonical Space root:

- `web_url = https://pirate.sc/c/@<root>`
- `freedom_url = https://pirate.sc/c/@<root>`
- TXT key `pirate-verify`
- TXT value `pirate-space-verify=<session-id>:<nonce>`

The nonce is single-use and expires with the namespace verification session.

## Verification Rule

Pirate accepts the session only when all checks pass:

- the root exists
- the root proof verifies against accepted Spaces anchors
- the resolved Fabric TXT record contains the expected `pirate-verify` value
- the resolved web and Freedom targets match Pirate's expected route
- the creator has the required `unique_human` verification

The durable assertion for the publish-control proof is `fabric_publish_verified`.

## Durable publication receipt

`--signed-message-out` is required for Pirate-operated publishing. It creates the exact signed
Fabric envelope before the initial broadcast, refuses to overwrite an existing file, and writes
with mode `0600`. Record the `message_sha256` emitted by the publisher alongside the namespace
verification session.

If propagation must be refreshed, copy only the retained envelope to the rebroadcast host and run:

```bash
spaces-publisher rebroadcast \
  --message-file /path/to/signed-publications/@pirate-<session-id>.fabric-message
```

Do not rebroadcast an archive merely because it is the newest file on disk. First bind its recorded
SHA-256 and session to the currently intended selected sequence. Replaying an older, still-valid
owner signature can repopulate stale relay state.

## Publisher CLI

The public helper repo is:

- `https://github.com/pirate/pirate-spaces-publisher`

`pirate-spaces-publisher` is the active public repo name. Treat `spaces-publisher` as superseded and
archive it after confirming no release or deploy process still reads from it.

The source in this workspace lives at:

- [tools/spaces-publisher](../../tools/spaces-publisher)

The helper supports repeatable generic TXT records:

```bash
go run github.com/pirate-social-club/pirate-spaces-publisher@v0.1.5 publish @pirate \
  --wallet-export /path/to/wallet-export.json \
  --txt key=value \
  --txt other=value \
  --signed-message-out /path/to/signed-publications/@pirate-sequence-N.fabric-message
```

For Pirate verification, use the first-class `pirate-verify` TXT convention shown above.
