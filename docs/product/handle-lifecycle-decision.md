# Handle Lifecycle Decision

Status: accepted

Date: 2026-07-17

## Decision

Pirate handle claims are perpetual licensed rights in v0. `lease_started_at`,
`lease_expires_at`, and `grace_ends_at` remain nullable and unset. No background process may infer
expiry from claim age.

A future lease product must be introduced as an explicit, versioned namespace-policy mode with
claim-time disclosure, renewal payments, grace handling, notifications, sweeping, and UI support.
It may apply to new claims after activation. Existing perpetual claims must not be converted
without an explicit holder-facing migration and affirmative consent.

## Why

Paid claims already ship without lease terms, expiry dates, renewal prices, or renewal UI.
Retroactively treating those claims as leases would change the purchased product after payment.
Keeping v0 perpetual also makes the stored state truthful: current claim rows have null lease
fields and cannot enter the documented grace or expired states.

## Consequences

- Product and UI must not describe current claims as leases or show renewal controls.
- API claim creation continues to leave lease fields null.
- Namespace policy cannot enable lease mode until the full lifecycle exists.
- Revocation remains possible only under the existing policy-bound grounds and platform ToS.
- HNS root renewal is an infrastructure responsibility and is separate from app-level handle
  lifecycle; renewing `.pirate` does not renew individual handle rows.
