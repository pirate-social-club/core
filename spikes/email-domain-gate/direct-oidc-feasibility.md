# Minimal direct-OIDC feasibility spike

**Status:** specified, not started. No product integration or production OAuth
credentials are authorized.

**Decision prerequisite:** run only if employer/provider-visible application
authentication is acceptable for the target users. Use disposable organization
test accounts and tenants; never a private user account.

## Goal

Measure the minimum identity material Google and Microsoft necessarily disclose
while establishing the affiliation-badge claims. Do not assume “address-blind”
from a claim reference or infer Microsoft domain membership from mutable
email-like fields.

## Google first

Google documents `hd` as the hosted organization domain and says email is
included when the `email` scope is requested. Its current OIDC flow documentation
also says `openid` must be accompanied by `profile`, `email`, or both, so the
proposed `openid`-only flow is not established. Google advertises public subject
identifiers; `sub` is stable and opaque but not safely treated as pairwise or
client-scoped.

- [ ] G1. Register a disposable test OAuth client with exact redirect URIs and
  no production branding/domain.
- [ ] G2. Use authorization code + PKCE, fresh `state` and `nonce`, `hd=*`, and
  request `openid profile` without `email`. Do not call UserInfo.
- [ ] G3. Validate signature/JWK, `iss`, `aud`, `nonce`, `iat` and `exp` locally.
  Record only claim **names**, consent-screen permission text and whether `hd`,
  `sub`, `email`, name/profile claims are present. Never commit/log the token or
  claim values.
- [ ] G4. Confirm an organizational test account returns trustworthy `hd` and a
  consumer Gmail control returns no `hd`. Confirm a mismatched expected domain
  fails.
- [ ] G5. Repeat a fresh login to establish `sub` stability for Pirate dedup;
  store only `HMAC(server_secret, issuer || sub)` in the mock. Never echo raw
  `sub`.
- [ ] G6. Record the provider/admin audit event, consent behavior, app-blocking
  policy and whether the flow can avoid refresh/offline access.

**Google go/no-go:** proceed only if `hd` and stable `sub` are available without
the `email` scope, the returned incidental claims are explicitly accepted, and
the employer/provider-visible event is acceptable. Call the result
“email-scope-free” unless the real token proves no address is returned; do not
promise operator address-blindness from scopes alone.

## Microsoft second

Microsoft is a separate mechanism and privacy profile:

- [ ] M1. Use the organizations endpoint with authorization code + PKCE and the
  least delegated permission that can read the current tenant organization's
  `verifiedDomains`.
- [ ] M2. Validate issuer, audience, nonce, expiry, immutable `tid`, and stable
  `oid`/`sub`; never authorize from `email`, `preferred_username`, or
  `unique_name`.
- [ ] M3. Query only the organization fields needed for `verifiedDomains` and
  record what broader data the granted access token could technically read,
  even if Pirate code does not request it.
- [ ] M4. Test multi-domain tenant and guest/contractor behavior. Confirm and
  disclose that the claim is tenant membership where the tenant controls `D`,
  not possession of a mailbox at `D`.
- [ ] M5. Record admin consent/blocking/audit behavior and compare it separately
  with Google's result.

## Shared security and retention

- Reject wrong issuer, audience, nonce, state, expired token, unknown signing
  key, consumer account, unverified configured domain, and replay.
- Pin/cache provider discovery and JWK material with rotation and failure rules;
  never use debugging token-introspection endpoints for authorization.
- Do not request refresh tokens or offline access. Keep authorization codes,
  access/ID tokens, raw subjects and profile claims out of URLs, logs, Sentry,
  analytics and responses; discard them immediately after atomic finalization.
- Store only provider, public affiliation value, mechanism version, verified/
  expiry timestamps, and server-HMACed stable subject for best-effort dedup.
- Report Google and Microsoft results separately; they prove different claims
  and have different disclosure/permission surfaces.

## Primary references

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google ID-token claims](https://developers.google.com/identity/openid-connect/reference)
- [Microsoft claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
- [Microsoft Graph organization endpoint](https://learn.microsoft.com/en-us/graph/api/organization-get?view=graph-rest-1.0)
- [Microsoft Graph `verifiedDomains`](https://learn.microsoft.com/en-us/graph/api/resources/verifieddomain?view=graph-rest-1.0)
