# Account Creation First Slice

Status: execution handoff for the first runtime implementation

Related:

- [turso-secret-contract.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-secret-contract.md)
- [turso-provisioning-contract.md](/home/t42/Documents/pirate-v2/docs/control-plane/turso-provisioning-contract.md)
- [control-plane-schema.md](/home/t42/Documents/pirate-v2/docs/control-plane/control-plane-schema.md)
- [specs/api/src/paths/auth.yaml](/home/t42/Documents/pirate-v2/specs/api/src/paths/auth.yaml)

## Goal

Get Pirate to the first executable account-creation path with the smallest possible dependency set.

For this repo, "account creation" means:

1. accept an upstream auth proof
2. upsert the Pirate user
3. create the generated signup identity
4. issue a Pirate app session
5. prove that session on at least one authenticated read route

This is narrower than the full community slice. It intentionally stops before namespace verification and community provisioning.

## Decision

The first executable auth provider should be `jwt_based_auth`, not Privy.

Reason:

- the first-slice freeze requires the Worker to run end to end through `jwt_based_auth`
- Bruno must be able to run the happy path without a browser
- Privy can be added later as another upstream proof type that feeds the same normalized exchange path

Privy remains part of the v0 product direction, but it is not the first blocker for backend execution.

## Future CLI Auth Note

This first-slice JWT path is not the intended long-term human CLI login experience.

When Pirate adds a real CLI auth flow, it should follow a browser handoff pattern similar to GitHub device flow:

- the CLI starts an auth session and shows a short code
- the user opens Pirate in a browser, signs in, and enters or confirms that code
- Pirate completes the CLI auth session and returns a Pirate app session to the terminal client

That future CLI flow should terminate at the same normalized Pirate session layer used by web and mobile. It does not change the value of the current JWT-first slice, which still exists to prove the backend exchange boundary, account bootstrap, and authenticated read routes without needing a browser.

## Minimum Runtime Scope

The runtime repo should implement only this first:

1. `POST /auth/session/exchange`
2. `GET /users/me`
3. `GET /onboarding/status`

`POST /auth/session/exchange` must:

- verify the upstream JWT
- resolve the upstream subject from `iss` + `sub`
- upsert `users`
- upsert `auth_provider_links`
- return `wallet_attachments` in every successful response
- create the generated `.pirate` handle for a new user
- create the default profile row for a new user
- issue a Pirate bearer token
- return `SessionExchangeResponse`

`GET /users/me` and `GET /onboarding/status` only exist here to prove that the app session works after exchange.

### JWT-First Wallet Rule

For the first executable `jwt_based_auth` slice, wallet attachments are not inferred from JWT custom claims and are not supplied in the request body.

Rules:

- the `jwt_based_auth` request variant creates no wallet attachments in v0 of this slice
- the handler must still return `wallet_attachments` because the response schema requires it
- for a newly created JWT-path user, `wallet_attachments` should therefore be `[]`
- for an existing user previously enriched through another path, the handler may return that user's already-persisted active wallet attachments
- Sentinel dVPN wallet creation is explicitly out of scope for session exchange; that wallet must be lazy-created only after the user has a paid dVPN entitlement and requests the feature

If Pirate later wants wallet-aware JWT bootstrap, that should be added as an explicit contract change rather than an implicit undocumented custom-claim dependency.

## Deliberately Out Of Scope

Do not block the first account-creation slice on:

- Privy SDK integration
- Sentinel wallet provisioning
- dVPN payment gating
- browser/device-style CLI auth
- namespace verification
- `POST /communities`
- Turso group creation
- per-community database token wrapping
- queue infrastructure
- async jobs beyond what the auth flow itself needs

Those belong to the next slice.

## Required Database Surface

Only the central control-plane database is required for account creation.

Use the existing control-plane identity schema as the source of truth:

- `users`
- `wallet_attachments`
- `auth_provider_links`
- `global_handles`
- `profiles`

Helpful local bootstrap:

- apply `db/control-plane/migrations`
- seed one JWT-compatible upstream fixture
- seed one existing user fixture for idempotency and resume-path testing

Do not require any community database or provisioning worker to create accounts.

## Worker Env Contract

The runtime repo should split config into ordinary Worker vars versus secrets.

### Ordinary Worker vars

These belong in version-controlled Worker config such as `wrangler.toml`:

- `AUTH_UPSTREAM_JWT_ISSUER`
- `AUTH_UPSTREAM_JWT_AUDIENCE`
- `PIRATE_APP_JWT_ISSUER`
- `PIRATE_APP_JWT_AUDIENCE`

### Worker secrets

These should be injected as Worker secrets:

- `CONTROL_PLANE_DATABASE_URL`
- `PIRATE_APP_JWT_PRIVATE_KEY`
- `AUTH_UPSTREAM_JWT_SHARED_SECRET`

Do not add `CONTROL_PLANE_MIGRATOR_DATABASE_URL` or `TURSO_PLATFORM_API_TOKEN` to the public API worker.

### Pirate App Session Token

For the first slice, Pirate should issue its own bearer token with:

- algorithm: `RS256`
- expiration: `1 hour`

The token should carry only identity/session claims such as `iss`, `aud`, `sub`, `iat`, and `exp`. Do not embed mutable profile state in the token.

## Infisical Guidance

For this first account-creation slice, the minimum Infisical surface is:

### `dev:/services/api`

- `CONTROL_PLANE_DATABASE_URL`
- `PIRATE_APP_JWT_PRIVATE_KEY`
- `AUTH_UPSTREAM_JWT_SHARED_SECRET`

### Not needed yet

- `TURSO_PLATFORM_API_TOKEN`
- `CONTROL_PLANE_MIGRATOR_DATABASE_URL`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- any per-community Turso credential
- any Privy secret material

## Privy Guidance

Do not make Privy secret setup the first step.

The repo does not yet lock the exact server-side Privy verification contract. Until that exists, do not create a speculative "Privy private key" path in Infisical just to unblock account creation.

Recommended order:

1. ship `jwt_based_auth`
2. prove the normalized exchange path with Bruno
3. add Privy as a second accepted upstream proof type
4. classify the exact Privy secret surface after the runtime implementation needs it

## Handle Generation And Idempotency

Generated global handles for signup should follow the existing v0 profile policy:

- use the `adjective-noun-4digits.pirate` pattern
- use allowlisted words
- pass profanity and reserved-word filtering
- use a random numeric suffix
- do not derive the final label deterministically from `iss`, `sub`, or `user_id`

The auth exchange remains idempotent because handle generation only happens on the first successful creation of a new canonical `user_id`.

Practical rule:

- first look up the canonical user by active `(provider, provider_subject)`
- if the auth-provider link already exists, resume that `user_id` and do not generate a new handle
- only the "new user" branch attempts handle generation
- on `label_normalized` uniqueness conflict, generate a fresh candidate and retry inside the same transaction loop

Label convention:

- `label_normalized` stores the bare handle, for example `swift-fox-3847`
- `label_display` stores the user-facing form, for example `swift-fox-3847.pirate`
- the API `GlobalHandle.label` field maps to `label_display`
- the handle generator should operate on bare labels and append `.pirate` only for display

This keeps generated handles non-guessable while preserving idempotency on repeated exchange for the same upstream proof.

## Bruno Guidance

Bruno should target the JWT path first.

Environment values:

- `base_url`
- `upstream_jwt`
- `pirate_access_token`

Happy-path requests:

1. `POST /auth/session/exchange`
2. `GET /users/me`
3. `GET /onboarding/status`

Failure-path requests:

- expired upstream JWT
- wrong issuer
- wrong audience
- malformed JWT
- bearer call without `pirate_access_token`

## Logical Ordering

Implement in this order:

1. Apply the central control-plane migrations locally.
2. Use HMAC-backed upstream JWT verification for the first local slice.
3. Define the Worker env contract.
4. Wire the Worker to the central control-plane database.
5. Implement `POST /auth/session/exchange`.
6. Add generated handle/profile bootstrap for new users.
7. Implement Pirate bearer-token issuance and verification.
8. Implement `GET /users/me`.
9. Implement `GET /onboarding/status`.
10. Run the Bruno happy path.
11. Run the Bruno failure cases.
12. Only after that, move to namespace verification and community provisioning.

JWKS-backed verification can be added later when Pirate has a real upstream issuer to trust in non-local environments.

## Exit Criteria

This first account-creation slice is complete when:

- a local Worker can accept `jwt_based_auth`
- the exchange path is idempotent on the same upstream proof
- a new user receives a generated `.pirate` handle and default profile row
- an existing user resumes the same canonical `user_id`
- Bruno can run the happy path without a browser
- Bruno can prove at least the basic auth failure cases

## After This Slice

The next blocked work after account creation is:

1. namespace verification
2. community create
3. Turso provisioning
4. async job polling

That is when these become required:

- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_COMMUNITY_DB_WRAP_KEY`
- the private control-plane provisioning surface
