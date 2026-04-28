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
go run github.com/pirate/pirate-spaces-publisher@v0.1.0 publish @pirate \
  --wallet-export /path/to/wallet-export.json \
  --web https://pirate.sc/c/@pirate \
  --freedom https://pirate.sc/c/@pirate \
  --txt pirate-verify=pirate-space-verify=<session-id>:<nonce>
```

After the publish succeeds, the operator clicks **Check setup** in Pirate.

For nontechnical operators, the wallet export path should be a local file path copied or dragged
into Terminal. The file must not be uploaded to Pirate.

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

## Publisher CLI

The public helper repo is:

- `https://github.com/pirate/pirate-spaces-publisher`

`pirate-spaces-publisher` is the active public repo name. Treat `spaces-publisher` as superseded and
archive it after confirming no release or deploy process still reads from it.

The source in this workspace lives at:

- [tools/spaces-publisher](../../tools/spaces-publisher)

The helper supports repeatable generic TXT records:

```bash
go run github.com/pirate/pirate-spaces-publisher@v0.1.0 publish @pirate --wallet-export /path/to/wallet-export.json --txt key=value --txt other=value
```

For Pirate verification, use the first-class `pirate-verify` TXT convention shown above.
