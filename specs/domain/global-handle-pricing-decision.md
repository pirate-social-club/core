# Global Handle Self-Service Pricing Decision

Status: proposed; product decision required by **2026-07-24**

Related docs:

- [profile.md](./profile.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)

## Decision Required

Choose which global `.pirate` labels may be purchased through the ordinary self-service quote flow.
This decision is time-boxed because the current production policy sells labels as short as three
characters without review.

Current runtime behavior:

- `8+` characters: standard self-service, normally USD 5 after the cleanup window
- `7` characters: self-service, normally USD 10
- `6` characters: self-service, normally USD 25
- `5` characters: self-service, normally USD 50
- `4` characters: self-service, normally USD 100
- `3` characters: self-service, normally USD 250
- premium terms may change the price or force a manual sale, but length alone does not require review

This conflicts with the intended v0 posture in [profile.md](./profile.md): six-character labels require
manual review and labels of one to five characters are reserved, auction-only, or admin-assigned.

## Recommendation

Adopt the conservative v0 inventory policy:

- `8+` characters: standard self-service
- `7` characters: fixed-price premium self-service
- `6` characters: not self-service; manual review only
- `1-5` characters: reserved from ordinary quotes; future auction or admin grant only

The settlement wallet remains a payment rail. Payment does not create a transferable token or
wallet-owned name; a purchased global handle remains bound to the authenticated user under the
global-handle lifecycle.

## Interim Guard

If the permanent policy is not approved by **2026-07-24**, ship a narrow fail-closed guard in
`resolveGlobalHandlePaidPrice`:

- labels of six or fewer normalized characters return `eligible = false`
- use a stable reserved/manual-review pricing tier and user-safe reason
- keep seven-character and `8+` behavior unchanged
- change the global-handle paid-policy version so outstanding quotes cannot cross policy semantics

This is deliberately reversible. Removing or relaxing the guard still requires an explicit product
decision and a new policy version.

## Acceptance And Rollback

Required tests for either the permanent policy or interim guard:

1. length boundaries at 5, 6, 7, and 8 characters
2. reserved and premium-term precedence
3. base, numeric, hyphenated, and punycode labels
4. cleanup-window behavior remains limited to eligible standard `8+` labels
5. stale quotes from the previous policy version are rejected
6. API quote responses expose the intended `eligible`, `pricing_tier`, `reason`, and `policy_version`

Rollback means restoring the previous eligibility table under another explicit policy version. Do not
silently reuse a version whose meaning has changed.

## Product Sign-Off

Record before the deadline:

- chosen length tiers and prices
- manual-review owner and service-level expectation, if six-character review is enabled
- reservation/auction posture for one-to-five-character inventory
- effective policy version and rollout date
- named product approver
