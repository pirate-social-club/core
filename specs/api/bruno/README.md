# Bruno First Slice

This folder is the handoff for the first executable account-creation flow.

The initial Bruno target is the JWT path, not the Privy browser path.

This JWT path is also not the intended long-term human CLI login path. A future CLI flow should use a browser handoff or device-code-style session and then land on the same Pirate session model after backend exchange.

## Collection Layout

Suggested collection layout:

- `00-auth/session-exchange-jwt`
- `00-auth/get-users-me`
- `00-auth/get-onboarding-status`
- `90-failures/get-onboarding-status-without-token`
- `90-failures/session-exchange-expired-jwt`
- `90-failures/session-exchange-malformed-jwt`
- `90-failures/session-exchange-wrong-issuer`
- `90-failures/session-exchange-wrong-audience`
- `90-failures/get-users-me-without-token`

This is intentionally narrower than the full community first slice.

## Environment Variables

Use these Bruno environment values:

- `base_url`
- `upstream_jwt`
- `pirate_access_token`
- `pirate_user_id`

Helpful failure-case env values:

- `upstream_jwt_expired`
- `upstream_jwt_malformed`
- `upstream_jwt_wrong_issuer`
- `upstream_jwt_wrong_audience`

Optional diagnostic values:

- `jwt_issuer`
- `jwt_subject`

This folder now includes:

- `bruno.json`
- `environments/local.bru`
- happy-path requests under `00-auth/`
- failure-case requests under `90-failures/`

## Request Shapes

### `POST /auth/session/exchange`

Request:

```json
{
  "proof": {
    "type": "jwt_based_auth",
    "jwt": "{{upstream_jwt}}"
  }
}
```

Success expectations:

- status `200`
- body contains `access_token`
- body contains `user`
- body contains `profile`
- body contains `onboarding`
- body contains `wallet_attachments`

Bruno post-response step:

- save `res.body.access_token` into `pirate_access_token`
- save `res.body.user.user_id` into `pirate_user_id`

### `GET /users/me`

Header:

```text
Authorization: Bearer {{pirate_access_token}}
```

Success expectations:

- status `200`
- body `user_id` matches the user returned by session exchange

### `GET /onboarding/status`

Header:

```text
Authorization: Bearer {{pirate_access_token}}
```

Success expectations:

- status `200`
- payload is present even for a newly created user

## Failure Cases

### Expired JWT

Use a token with an `exp` in the past.

Expected result:

- status `401`
- body shape:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

### Wrong issuer

Use a token with the wrong `iss`.

Expected result:

- status `401`
- body shape:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

### Wrong audience

Use a token with the wrong `aud`.

Expected result:

- status `401`
- body shape:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

### Malformed JWT

Use a syntactically invalid token or an otherwise unparsable JWT string.

Expected result:

- status `401`
- body shape:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

### Missing Pirate bearer token

Call `GET /users/me` without `Authorization`.

Expected result:

- status `401`
- body shape:

```json
{
  "code": "auth_error",
  "message": "Authentication failed",
  "retryable": false
}
```

The same expectation applies to `GET /onboarding/status` without `Authorization`.

## Runtime Notes

The runtime repo should implement the JWT verification mode first. The first local slice should use HMAC verification with `AUTH_UPSTREAM_JWT_SHARED_SECRET`. Once that is working, Privy can be added as another request variant for the same `POST /auth/session/exchange` endpoint, and JWKS-backed upstream verification can be added when a real issuer exists.
