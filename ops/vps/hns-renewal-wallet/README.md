# HNS Renewal Wallet Host

Status: **DESIGN ONLY — NOT IMPLEMENTED OR DEPLOYED**.

This is the trust role that renews Pirate-controlled Handshake roots such as `pirate`. It is not
the keyless chain observer and it is not either authoritative DNS server.

## Placement

The production roles remain separate:

- primary edge on netcup: PowerDNS primary, verifier, and public gateway
- secondary authority on Hetzner: PowerDNS secondary only
- chain observer: keyless `hsd --no-wallet`, used for expiry evidence
- renewal wallet host: wallet-bearing `hsd`, used only to construct and broadcast approved renewal transactions

Ordering or deploying the Hetzner secondary does not create renewal capability. Never copy a seed,
wallet database, or wallet RPC credential to the netcup edge, Hetzner secondary, or observer.

## Initial operating model

Use operator-assisted renewal for v0. The host may remain stopped except for sync, health checks,
and an approved renewal window. Do not schedule unattended `sendrenewal` until transaction policy,
alerting, backup recovery, and a second-person approval mechanism have all been exercised.

The first production renewal requires two operators:

1. one operator verifies the chain, name state, ownership coin, destination wallet, and proposed fee
2. a second operator confirms the same evidence and authorizes wallet unlock/signing
3. the broadcaster records the transaction hash and locks the wallet immediately afterward
4. both operators verify confirmation and the new renewal horizon through the independent keyless observer

No approval material or private key may be pasted into an issue, chat, CI log, or shell history.

## Runtime boundary

The eventual deployment must:

- build a reviewed, digest-pinned `hsd` release from verified source
- run mainnet with DNS serving disabled
- expose node and wallet RPC only on loopback; no reverse proxy, public firewall rule, or provider load balancer
- disable inbound P2P unless a reviewed synchronization requirement proves it necessary
- run under a dedicated Unix account with a read-only application filesystem
- place chain state and wallet state on distinct paths with distinct backup classifications
- keep the wallet encrypted at rest and locked outside the short signing window
- prohibit unrelated wallets, application services, DNS databases, and Spaces keys on the host

Unlike the pruned observer, this role must be recoverable from its wallet backup and able to rescan
the chain after restore. Choose archival/pruning settings only after a restore-and-rescan test proves
the chosen mode can recover the ownership coin without relying on the live host's existing database.

## Key custody

Before provisioning, record and approve:

- which wallet currently owns each root and whether any transfer is still pending
- seed generation ceremony and two-person custody model
- encrypted backup format, locations, and restore test cadence
- wallet encryption and unlock procedure
- who may approve, sign, and broadcast a renewal
- emergency rotation and compromised-host response
- how the host is rebuilt without copying unencrypted key material through an operator workstation

The seed backup is the recovery authority. A disk snapshot alone is not a wallet backup. Store at
least two encrypted copies in separate failure domains, and perform a restore on an isolated host
before treating the role as available. Do not automatically place the seed in Infisical merely
because service credentials live there; key-custody selection requires an explicit security review.

## Renewal preflight

The runbook must derive state from the synced mainnet node rather than from an explorer or a hard-coded
calendar date. Immediately before signing, capture:

- network, best block, header height, verification progress, and tip age
- `getnameinfo` for the exact root
- wallet ownership of the current name coin
- current renewal height/horizon and the protocol-valid renewal window
- wallet balance, selected fee rate, and resulting transaction fee
- absence of an unconfirmed or recently confirmed renewal for the same name
- expected transaction covenant and name, decoded before broadcast

The exact wallet RPC/CLI invocation must be pinned and proven against the selected `hsd` version in
regtest or testnet. Do not paste an unverified `sendrenewal` command into the production runbook.

## Broadcast and verification

After dual approval:

1. unlock only the renewal wallet for a bounded interval
2. create, decode, and compare the renewal transaction with the approved preflight
3. broadcast once and record the transaction hash in the private operations record
4. lock the wallet and remove transient unlock material
5. observe mempool admission and confirmation from the wallet node
6. independently verify the confirmed name state and renewed horizon through the keyless observer
7. confirm the API revalidation job no longer reports the root inside its warning horizon

A timeout is not permission to broadcast again. Resolve the original transaction by hash and wallet
history before considering fee replacement or another renewal.

## Monitoring

The keyless observer remains the monitoring source so routine alerts never depend on wallet access.
It should emit configurable warning and critical horizons, plus an explicit `renew now` page. Alerts
must include the root, observed height, renewal horizon, evidence time, and observer anchor, but no
wallet or secret material.

The wallet host additionally reports only non-secret health:

- node synchronization and tip age
- disk capacity
- last successful encrypted backup and restore-test age
- wallet locked/unlocked state
- last approved renewal transaction and confirmation state

Any unexpected unlocked state is critical.

## Acceptance gate

The role is not production-ready until all of these pass:

- pinned build and containment review
- no public node, wallet, DNS, or metrics listener
- fresh-host wallet restore and ownership-coin recovery
- regtest/testnet renewal, restart, duplicate-broadcast, and confirmation-loss exercises
- alert delivery at warning, critical, and `renew now` horizons
- dual-control production dry run that stops before signing
- documented rollback and compromised-host procedure
- first production renewal observed independently by the keyless observer

Until then, renewal is an operator blocker and must not be implied by the observer or DNS deployment docs.
