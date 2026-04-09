# Auth Session Exchange Transaction Shape

Status: implementation handoff

Related:

- [account-creation-first-slice.md](/home/t42/Documents/pirate-v2/docs/account-creation-first-slice.md)
- [community-api-first-slice-freeze.md](/home/t42/Documents/pirate-v2/docs/community-api-first-slice-freeze.md)
- [db/control-plane/migrations/0001_control_plane_identity.sql](/home/t42/Documents/pirate-v2/db/control-plane/migrations/0001_control_plane_identity.sql)

## Purpose

Define the concrete write pattern for `POST /auth/session/exchange` in the first JWT-based account-creation slice.

This doc exists so the runtime repo can implement the handler without reopening core questions about:

- canonical user resolution
- signup-handle bootstrap
- response assembly
- idempotency
- concurrent exchange races

## First-Slice Assumptions

- upstream proof type is `jwt_based_auth`
- local development uses HMAC verification with `AUTH_UPSTREAM_JWT_SHARED_SECRET`
- the validated upstream identity key is `(iss, sub)`
- wallet attachments are not created by this JWT-first slice
- `wallet_attachments` is always present in the response and is `[]` for a new JWT-path user

## Claims Contract

The first slice should require only these validated claims:

- `iss`
- `sub`
- `aud`
- `exp`

Optional claims may be logged or surfaced later, but they do not affect the write path in this slice.

## Canonical Resolution Rule

Map the validated upstream identity to:

- `provider = 'jwt'`
- `provider_subject = <iss> + '|' + <sub>`

`provider_subject` should be a stable opaque string derived from the validated claims, not from unverified request input.

For the JWT path:

- `provider_subject = <iss> + '|' + <sub>`
- `provider_user_ref = <sub>`

`provider_user_ref` is a convenience reference only. It is not the uniqueness key.

## Serialization Modules

The runtime repo should keep serialization out of the route handlers.

Recommended modules:

- `verification-serializer`
  Maps `verification_capabilities_json` in the database to and from the API `VerificationCapabilities` schema.
- `profile-assembler`
  Merges the `profiles` row and the referenced `global_handles` row into the API `Profile` object with nested `global_handle`.
- `session-exchange-response`
  Assembles `user`, `profile`, `onboarding`, and `wallet_attachments` into `SessionExchangeResponse`.

The route handler should orchestrate the flow, not hand-build nested response objects inline.

## Transaction Shape

Run the exchange write path in one database transaction.

High-level shape:

1. Verify the upstream JWT before opening the write transaction.
2. Begin transaction.
3. Attempt to load the active `auth_provider_links` row for `(provider, provider_subject)`.
4. If found:
   - load the linked `users` row
   - load the active `profiles` row
   - load the active `global_handles` row
   - load active `wallet_attachments`
   - commit
   - issue the Pirate session token from the resolved `user_id`
   - return the assembled response
5. If not found:
   - create `user_id`
   - insert `users`
   - create one generated global handle with retry on unique-label conflict
   - insert `profiles`
   - insert `auth_provider_links`
   - commit
   - issue the Pirate session token from the new `user_id`
   - return the assembled response with `wallet_attachments: []`

## Suggested SQL Sequence

Pseudocode only. The runtime repo may use an ORM or raw SQL, but the write semantics should match this order.

### 1. Resolve existing link

```sql
SELECT auth_provider_link_id, user_id
FROM auth_provider_links
WHERE provider = ?
  AND provider_subject = ?
  AND status = 'active'
LIMIT 1;
```

If found, resolve:

```sql
SELECT *
FROM users
WHERE user_id = ?;

SELECT *
FROM global_handles
WHERE user_id = ?
  AND status = 'active'
LIMIT 1;

SELECT *
FROM profiles
WHERE user_id = ?;

SELECT *
FROM wallet_attachments
WHERE user_id = ?
  AND status = 'active'
ORDER BY is_primary DESC, created_at ASC;
```

### 2. Insert new user branch

Insert the canonical user first:

```sql
INSERT INTO users (
  user_id,
  primary_wallet_attachment_id,
  verification_state,
  capability_provider,
  verification_capabilities_json,
  verified_at,
  nationality,
  current_verification_session_id,
  created_at,
  updated_at
) VALUES (?, NULL, 'unverified', NULL, ?, NULL, NULL, NULL, ?, ?);
```

The initial `verification_capabilities_json` for a new user should be exactly:

```json
{
  "unique_human": {
    "state": "unverified"
  },
  "age_over_18": {
    "state": "unverified"
  },
  "nationality": {
    "state": "unverified",
    "value": null
  },
  "gender": {
    "state": "unverified",
    "value": null
  },
  "wallet_score": {
    "state": "unverified"
  }
}
```

This exact blob should be:

- stored in `verification_capabilities_json`
- returned by the serializer as the API `verification_capabilities`
- reused as the fallback baseline when hydrating any missing or null capability payload in local development

### 3. Insert generated handle with retry

Loop:

1. generate a candidate label
2. normalize it
3. attempt insert
4. on unique active-label conflict, generate a new candidate and retry

Label mapping rules:

- `label_normalized` is the bare handle without `.pirate`
- `label_display` is the bare handle plus `.pirate`
- API `GlobalHandle.label` maps to `label_display`

```sql
INSERT INTO global_handles (
  global_handle_id,
  user_id,
  label_normalized,
  label_display,
  status,
  tier,
  issuance_source,
  redirect_target_global_handle_id,
  price_paid_usd,
  free_rename_consumed,
  issued_at,
  replaced_at,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, 'active', 'generated', 'generated_signup', NULL, NULL, 0, ?, NULL, ?, ?);
```

The runtime should cap retries and surface an internal error if generation keeps colliding unexpectedly.

### 4. Insert profile

```sql
INSERT INTO profiles (
  user_id,
  display_name,
  bio,
  avatar_ref,
  cover_ref,
  global_handle_id,
  created_at,
  updated_at
) VALUES (?, NULL, NULL, NULL, NULL, ?, ?, ?);
```

### 5. Insert auth-provider link

```sql
INSERT INTO auth_provider_links (
  auth_provider_link_id,
  user_id,
  provider,
  provider_subject,
  provider_user_ref,
  status,
  linked_at,
  revoked_at,
  created_at,
  updated_at
) VALUES (?, ?, 'jwt', ?, ?, 'active', ?, NULL, ?, ?);
```

## Concurrency Rule

Two requests for the same valid upstream proof may race.

The implementation should rely on the unique active index on `(provider, provider_subject)` as the final guardrail.

Recommended behavior:

1. If both requests miss the initial lookup, both may try the new-user branch.
2. One insert into `auth_provider_links` will win.
3. If the second transaction loses on the unique link constraint, roll back that transaction.
4. Start a new transaction or fresh read scope.
5. Re-read by `(provider, provider_subject)`.
6. Return the now-canonical user instead of surfacing `409`.

This is how auth exchange stays idempotent under concurrency.

## Response Assembly

Successful response must include:

- `access_token`
- `user`
- `profile`
- `onboarding`
- `wallet_attachments`

First-slice rules:

- `wallet_attachments` is `[]` for a newly created JWT-path user
- `onboarding` should be returned even if it is a minimal default state
- the active global handle returned in `profile.global_handle` must match the persisted `global_handles` row created in the transaction

`Profile` assembly rules:

1. Read the `profiles` row.
2. Read the referenced `global_handles` row using `profiles.global_handle_id`.
3. Build the API `profile.global_handle` object from the `global_handles` row.

`GlobalHandle` field mapping:

- `global_handle_id` -> `global_handle_id`
- `label_display` -> `label`
- `tier` -> `tier`
- `status` -> `status`
- `issuance_source` -> `issuance_source`
- `redirect_target_global_handle_id` -> `redirect_target_global_handle_id`
- `price_paid_usd` -> `price_paid_usd`
- `free_rename_consumed` integer -> `free_rename_consumed` boolean
- `issued_at` -> `issued_at`
- `replaced_at` -> `replaced_at`

Recommended default onboarding payload for a newly created JWT-path user:

```json
{
  "generated_handle_assigned": true,
  "cleanup_rename_available": true,
  "reddit_verification_status": "not_started",
  "reddit_import_status": "not_started",
  "suggested_community_ids": []
}
```

Onboarding derivation rules for `GET /onboarding/status` and session exchange:

- `generated_handle_assigned = (active_global_handle.issuance_source == 'generated_signup')`
- `cleanup_rename_available = (active_global_handle.free_rename_consumed == false)`
- `reddit_verification_status = 'not_started'` in the first slice unless later onboarding tables say otherwise
- `reddit_import_status = 'not_started'` in the first slice unless later onboarding tables say otherwise
- `suggested_community_ids = []` in the first slice

## Error Shape

Authentication failures should use the shared API error schema:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

The exact message may vary, but `code` should remain `auth_error`.

## Pirate Session Token

Pirate should issue its own bearer token after the transaction commits.

First-slice token contract:

- algorithm: `RS256`
- expiration: `1 hour`
- required claims:
  - `iss = PIRATE_APP_JWT_ISSUER`
  - `aud = PIRATE_APP_JWT_AUDIENCE`
  - `sub = user_id`
  - `iat`
  - `exp`

Do not place profile data, onboarding state, or handle labels inside the token.

## Test Expectations

Minimum implementation tests should include:

1. new JWT exchange creates a user and returns all required top-level response fields
2. `profile.global_handle` is a fully populated nested object, not an ID
3. generated handle matches `adjective-noun-4digits` and API `label` includes `.pirate`
4. second exchange with the same upstream JWT returns the same canonical `user_id`
5. new JWT-path user returns `wallet_attachments: []`
6. malformed JWT returns `401 auth_error`
7. wrong issuer returns `401 auth_error`
8. wrong audience returns `401 auth_error`
9. expired JWT returns `401 auth_error`
10. authenticated `/users/me` works with the returned Pirate token
11. authenticated `/onboarding/status` derives state from the active global handle row
12. concurrent duplicate exchange resolves to one canonical user

## Non-Goals

This transaction shape does not yet cover:

- Privy token verification
- wallet discovery from upstream providers
- verification-session creation
- refresh tokens
- session revocation lists
- namespace verification bootstrap
