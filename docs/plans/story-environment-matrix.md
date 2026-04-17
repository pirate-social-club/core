# Story Environment Matrix

This document defines the two dimensions that matter for Story deployments and funded operations:

1. app/runtime environment
2. chain/deploy environment

Do not collapse them into one overloaded label like "production".

## Two Axes

### App/runtime environment

- `dev`
- `staging`
- `prod`

This axis controls:

- Infisical hosted secret paths
- API/runtime config
- control-plane databases
- operator endpoints

### Chain/deploy environment

- local disposable chain / throwaway deploys
- Story Aeneid testnet
- Story mainnet

This axis controls:

- which contracts are being deployed
- which signer model is allowed
- whether funds or ownership are real

## The Rule

Always name a Story surface using both axes.

Examples:

- `staging + Story Aeneid`
- `prod + Story Aeneid`
- `prod + Story mainnet`

If you say only `production`, that is ambiguous.

## Signing Model

### `dev + local disposable`

- raw hot key allowed
- local Foundry convenience is acceptable
- `STORY_CONTRACT_OWNER_PRIVATE_KEY` may be supplied as an operator-local env var if needed

### `staging + Story Aeneid`

- should rehearse the same operational model intended for mainnet
- Chipotle is acceptable for approved hot operator actions
- Keystone is preferred for ownership / privileged deploy authority if this environment is being used as a mainnet rehearsal

### `prod + Story Aeneid`

- optional dress-rehearsal surface
- if it exists, it must be named explicitly
- should follow the same signer boundary as `prod + Story mainnet`

### `prod + Story mainnet`

- Keystone cold wallet for ownership and privileged deployment/signing
- Chipotle only for approved hot operator actions
- no raw Story owner private key in Infisical
- no owner private key in AI workflows

## Infisical Policy

### Hosted contract

Hosted environments use `/services` only.

- `/services/api`
- `/services/control-plane`

### Local-only contract

`/local` is dev-only convenience and break-glass material.

- `dev` may use `/local`
- `staging` should not use `/local`
- `prod` should not use `/local`

If hosted break-glass storage is ever needed, use a clearly separate ops/break-glass path instead
of overloading `/local`.

## Story-Specific Secret Policy

- `STORY_CONTRACT_OWNER_PRIVATE_KEY` is not part of the hosted Infisical contract
- if still used at all, it is operator-local only for local/dev hot-key Foundry deploys
- staging and prod should not store it in Infisical

## Lit / Chipotle

Lit/Chipotle is not yet a required hosted runtime dependency.

Current policy:

- Lit keys are deferred in the shared Infisical contract
- Chipotle is an operator/action-signing mechanism, not a blanket replacement for cold ownership
- when Lit-backed runtime integrations go live, move the required keys into the hosted contract deliberately

## Real Funds

For real funds or real ownership on Story:

- do not rely on a raw hot owner key
- do not store the owner key in Infisical
- do not expose it to AI-attached sessions
- sign privileged deploy/ownership actions with Keystone

Chipotle can replace hot funded keys for approved operational actions. It does not replace the cold
root of authority.

## Practical Naming Guidance

Use these names in docs/runbooks/checklists:

- `dev-local`
- `staging-aeneid`
- `prod-aeneid-rehearsal`
- `prod-mainnet`

These are not necessarily Infisical environment slugs. They are operational labels to prevent
confusion.
