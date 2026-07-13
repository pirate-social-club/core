# HNS Chain Observer

This host role is the keyless Handshake chain reader required by the HNS
verifier's expiry assertion and the API's post-acceptance revalidation sweep.

It is a prerequisite for enabling namespace attachment. It is not:

- authoritative DNS
- a recursive resolver for end users
- a wallet
- a root-record signing or publishing service

## Initial Runtime

Use `hsd` on mainnet with the wallet plugin disabled. The node must:

- complete initial block download before the verifier is enabled
- keep `blocks == headers`
- expose JSON-RPC only on loopback or a private service network
- require a strong API key
- persist chain data on a monitored volume with sufficient growth headroom
- restart automatically and expose sync/tip-age health to operations

The verifier calls only:

- `getnameinfo <root>`
- `getblockchaininfo`

The API key belongs in Infisical and is passed to the HNS verifier as
`HNS_CHAIN_RPC_API_KEY`. Do not place any Handshake wallet, seed phrase, or root
signing material on this observer.

Deployment manifests are intentionally pending an image/version selection and
disk-sizing check. Do not deploy an unpinned floating image merely to fill this
directory.

## Shadow Observer

The Blink Labs Go node may run alongside `hsd` as a localhost-only, read-only
shadow. Diff the complete `getnameinfo` and `getblockchaininfo` responses used
by the verifier for at least 30 days, including restart, lag, and reorg cases.
Shadow output is telemetry only and must never grant a capability.

Promotion requires an explicit review and a compatibility test suite. Until
then, `hsd` is the production observer.
