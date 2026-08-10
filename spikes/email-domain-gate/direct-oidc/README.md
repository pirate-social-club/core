# Google direct-OIDC claim probe

Spike-only localhost harness for G1–G5 in
[`../direct-oidc-feasibility.md`](../direct-oidc-feasibility.md). It makes no
product changes and must use disposable test accounts.

## Safety boundary

- Binds only to `127.0.0.1`.
- Requests `openid profile`, never `email` or offline access.
- Uses authorization code + PKCE with one-time state and nonce.
- Calls no UserInfo endpoint.
- Validates the Google signature, issuer, audience, authorized party, nonce,
  issue time and expiry locally.
- Renders claim names and booleans only. It never renders or logs token, subject,
  hosted-domain, address, name or photograph values.
- Keeps the subject HMAC and results in process memory only.
- Attempts to revoke the short-lived access token immediately.

The Google/provider administrator may still record the application login. This
is the employer-visible property that distinguishes OIDC from local email ZK.

## Google Cloud setup

Use a disposable Google Cloud project and organizational test account:

1. Configure an OAuth consent screen in testing mode.
2. Create an OAuth client of type **Web application**.
3. Add exactly `http://127.0.0.1:8787/callback` as an authorized redirect URI.
4. Add only the disposable organizational account and consumer control as test
   users if the consent configuration requires them.
5. Copy `.env.oidc.example` to `.env.local`, set the client ID, client secret and
   expected organizational domain, then restrict the file to mode `0600`.

Do not paste credentials into chat or commit them. From this directory, run:

```sh
rtk node --env-file=.env.local run-google.mjs
```

Open `http://127.0.0.1:8787`. First run the organizational account twice to
measure subject stability, then run the consumer control. Record the consent
screen wording manually; do not capture account-identifying screenshots.

Stop the process with Ctrl+C. All in-memory results then disappear.

## Focused verification

```sh
rtk node --test google-oidc.test.mjs
```

## References

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OIDC API reference](https://developers.google.com/identity/openid-connect/reference)
