## Spaces Publisher

This tool is the owner-side CLI for native Spaces website records.

The wallet export produced by `space-cli exportwallet` contains a private descriptor with secret xprv material.
Treat it as wallet-equivalent.

- Keep the wallet export local.
- Never upload it to the VPS.
- Use the VPS only for read-only resolve operations.

Conventions:

- `Txt("web", ["https://example.com/"])` is the canonical website target
- `Txt("freedom", ["https://example/"])` is the Freedom-native override
- `Txt("pirate-verify", ["pirate-space-verify=<session>:<nonce>"])` is the Pirate session challenge

Primary local flow:

```bash
export SPACES_WALLET_EXPORT=~/safe/pirate-wallet.json

spaces-publisher inspect-wallet @pirate \
  --max-index 10000

spaces-publisher publish @pirate \
  --web https://pirate.sc/ \
  --freedom https://pirate/ \
  --txt pirate-verify=pirate-space-verify=nvs_example:nonce \
  --max-index 10000
```

Safer first pass:

```bash
spaces-publisher publish @pirate \
  --web https://pirate.sc/ \
  --txt pirate-verify=pirate-space-verify=nvs_example:nonce \
  --dry-run
```

`publish` and `clear` now print signer metadata when using a wallet export:

- `auth_mode`
- `matched_index`
- `matched_pubkey`
- `descriptor_path`
- `wallet_label`
- `wallet_blockheight`

Advanced fallback:

- `--secret-key` expects the already tap-tweaked 32-byte BIP-340 secret key.
- It does not accept an xprv or untweaked child key.

The tool currently depends on sibling clones at:

- `/home/t42/Documents/fabric-go`
- `/home/t42/Documents/libveritas-go`

via the `replace` directives in [go.mod](/home/t42/Documents/pirate-v2/tools/spaces-publisher/go.mod).

### Temporary `fabric-go` patch

The current upstream `fabric-go` clone needs one local compatibility fix for the current `libveritas-go` API:

```diff
- rs := libveritas.NewRecordSet(*z.Records)
+ rs := libveritas.NewRecordSet(z.Records)
```

Location:

- `/home/t42/Documents/fabric-go/fabric.go`

This should be upstreamed or removed once `fabric-go` is updated to the latest `libveritas-go`.
