# dVPN

Status: draft

Related docs:

- [user.md](./user.md)
- [monetization.md](./monetization.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [onboarding.md](./onboarding.md)
- [Sentinel Operator Runtime Contract](../../docs/operators/sentinel-operator-runtime-contract.md)
- [TUI Auth Home](../../docs/tui/tui-auth-home.md)
- [Account Creation First Slice](../../docs/product/account-creation-first-slice.md)
- [../api/src/paths/auth.yaml](../api/src/paths/auth.yaml)

## Purpose

This doc defines the v0 product and backend contract for paid Sentinel-backed dVPN access from Pirate.

It covers:

- when a Sentinel wallet should exist
- how dVPN activation is paid
- how the TUI should trigger wallet creation
- what is deferred from v0

## Implementation Status

Current repo status:

- paid dVPN entitlement gating is implemented
- Sentinel wallet creation is lazy and happens only after paid entitlement exists
- `POST /wallets/sentinel/ensure` is implemented
- `POST /sentinel/subscribe` is implemented
- `POST /sentinel/session/start` is implemented
- `DELETE /sentinel/session/{sentinel_session_id}` is implemented
- active session and active subscription reuse are implemented
- session and subscription expiry cleanup is implemented through the worker-side reaper
- the worker-side Sentinel operator contract is defined

Current implementation shape:

- Pirate owns the product entitlement and control-plane state
- Privy owns the user Cosmos wallet
- the API worker owns paid gating, wallet linking, persistence, and idempotent flow control
- the external Sentinel operator is expected to own actual allocation/session execution against Sentinel

Current persistence shape:

- `dvpn_feature_entitlements`
- `wallet_attachments`
- `sentinel_subscriptions`
- `sentinel_sessions`

Current implementation files:

- 
- 
- 
- 
- 
- 
- 

Still deferred:

- real Sentinel operator implementation
- real Sentinel chain/node integration validation
- finer distinction between session expiry and user-initiated end
- removing prototype patching from some runtime tests

## Core Principles

Recommended v0 posture:

- dVPN is an optional paid feature, not part of account bootstrap
- Pirate must not create a Sentinel wallet during ordinary signup or login
- Pirate should only create a Sentinel wallet after the user has an active paid dVPN entitlement
- user identity remains `user_id`; the Sentinel wallet is an attachment
- v0 should not depend on autobridge or swap execution

## Paid Activation

dVPN access should be treated as a paid P2P purchase.

Rules:

- if the user does not have an active paid dVPN entitlement, Pirate must not create a Sentinel wallet
- the first dVPN activation request should return a payment challenge rather than silently provisioning chain state
- a successful dVPN payment activates the feature for the user and unlocks wallet provisioning
- wallet creation is a post-payment side effect, not the thing being sold

Recommended v0 interpretation:

- the purchase grants a dVPN activation or service entitlement
- the entitlement is recorded in Pirate's app state
- after entitlement activation, Pirate may lazily create the user's Sentinel wallet attachment on first actual dVPN use

## Sentinel Wallet Provisioning Rule

The Sentinel wallet is lazy-created.

Recommended flow:

1. user authenticates to Pirate
2. user enters the TUI dVPN flow
3. Pirate checks whether the user already has an active paid dVPN entitlement
4. if not, Pirate returns `402 PaymentRequired`
5. after payment succeeds, Pirate re-enters the ensure flow
6. Pirate checks for an active `cosmos:sentinel` wallet attachment
7. if none exists, Pirate creates or resumes a Privy Cosmos wallet and stores it as a wallet attachment
8. Pirate stores provider-specific wallet metadata needed for future signing
9. Pirate ensures the user has an active Sentinel subscription allocation before session start

Important rule:

- repeated ensure calls for the same user must be idempotent and must not create multiple active Sentinel wallet attachments

## Wallet Attachment Shape

The canonical user-facing record remains `wallet_attachments`.

Recommended v0 Sentinel attachment values:

- `chain_namespace = cosmos:sentinel`
- `source_provider = privy`
- `attachment_kind = embedded`
- `status = active`

Provider-specific signing metadata should live in a sidecar table rather than expanding the canonical attachment shape for every wallet provider.

## TUI Contract

The TUI should not ask the user to provision a wallet directly.

Recommended v0 behavior:

- the TUI surfaces dVPN as a paid optional feature
- if the user has not paid, the TUI shows a payment-required state and browser handoff
- if the user has paid but has no Sentinel wallet yet, the backend provisions it transparently
- if the user has paid and already has a wallet, the backend reuses it

Visible TUI interpretation:

- `Connect` signs the user into Pirate
- dVPN activation is a separate paid feature inside the signed-in shell
- wallet creation is not a top-level TUI step
- subscription allocation happens after payment and wallet readiness, before transport session start

## Subscription Allocation

Recommended v0 backend posture:

- after wallet readiness, Pirate should ensure an active Sentinel subscription allocation for the user
- the user-facing state transition is `paid_wallet_ready -> plan_active`
- v0 should treat this as a treasury/admin action funded by Pirate rather than requiring the user to self-fund a Sentinel balance
- repeated allocation ensure calls must be idempotent and should return the existing active allocation when present

Recommended v0 API surface:

- `POST /wallets/sentinel/ensure`
- `POST /sentinel/subscribe`
- `POST /sentinel/session/start`

Recommended v0 persistence:

- `sentinel_subscriptions` stores the active allocation snapshot returned by Pirate's Sentinel treasury control plane
- session start should build on top of that state rather than recomputing subscription state on every connect
- `sentinel_sessions` stores the active session snapshot and the WireGuard connection payload needed for idempotent reconnect behavior

## Session Start

Recommended v0 backend posture:

- once a paid user has an active allocation, Pirate should start a Sentinel session on demand
- repeated session-start calls should return the existing active session when present
- v0 may persist the returned WireGuard connection payload so the backend can hand back the same active session without forcing a second chain-side start

Recommended state transition:

- `plan_active -> session_active`

## Purchase Boundary

The dVPN activation purchase is product-level commerce, not Story asset settlement.

Implications:

- v0 should not force dVPN activation through the Story purchase quote flow
- the authoritative requirement is that Pirate has a paid entitlement before creating the Sentinel wallet
- the transport of the payment challenge may reuse the existing MPP-style `402 PaymentRequired` API surface

## Deferred From V0

Explicitly out of scope:

- automatic bridge execution from a non-Cosmos asset into the Sentinel funding asset
- automatic swap routing for dVPN activation
- creating Sentinel wallets for all users at signup
- creating Sentinel wallets for users who only authenticate but never use dVPN
- backend custody of one Cosmos private key per user

## Future Upgrade Path

Later versions may add:

- autobridge or swap-assisted activation
- direct top-up of user-owned Sentinel balances
- offline additional-signer flows for bounded server-side actions
- migration from app-level dVPN entitlement to more explicit onchain quota allocation
