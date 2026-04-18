# HNS Public Profile Routing

Purpose: define how real `name.pirate` resolution should work without coupling it to the ICANN app domain or creating one DNS record per user.

This is the HNS-side counterpart to the web app rule:

- canonical web profile: `https://pirate.sc/u/<handle>`
- optional HNS-native mirror: `https://<label>.pirate`

## Product Rule

There are two public profile surfaces:

1. `pirate.sc/u/<handle>`
- default public web route
- works for every Pirate handle
- does not depend on HNS or custom DNS

2. `https://<label>.pirate`
- optional HNS-native route
- only works when the `.pirate` root is delegated and reachable through HNS infrastructure
- resolves to the same underlying Pirate profile data as `pirate.sc/u/<handle>`

Do not model public profiles as `*.pirate.sc`.

That is the wrong layer for this product.

## Scalability Rule

Do not provision one DNS record per user handle.

For HNS public profile routing, use:

- one authoritative zone for `pirate.`
- one wildcard web record under that root
- app-level resolution from the `Host` header

This scales because DNS stays constant while the application resolves whether:

- `blackbeard.pirate` exists
- the handle was renamed
- the handle redirects
- the handle is suspended
- the handle should 404

## DNS Model

For the `pirate.` HNS root, Pirate-managed authoritative DNS should serve:

- apex records for the root as needed
- `_pirate.pirate.` TXT for verification flows
- wildcard web routing for profile traffic

Recommended shape:

- `*.pirate.` -> public profile gateway
- optional apex `pirate.` -> app landing page or HNS landing page

Exact record type depends on the serving layer:

- if terminating directly on a VPS: `A` / `AAAA`
- if pointing at an external edge: `CNAME` / equivalent supported by the HNS serving stack

The important rule is:

- one wildcard web target for `*.pirate`
- not millions of per-label records

## PowerDNS Role

`ops/vps/hns-authoritative-dns` already establishes the right authority model.

PowerDNS should remain the source of truth for Pirate-managed HNS zones.

That means:

1. verifier/provisioner confirms the root is delegated to Pirate nameservers
2. PowerDNS serves the `pirate.` zone
3. verifier writes `_pirate.<root>` TXT records for namespace verification
4. PowerDNS also serves wildcard web-routing records for that root

For the public profile path, PowerDNS is not resolving users individually.
It is only routing all second-level names under `pirate.` to one web entrypoint.

## Gateway Rule

The web gateway receives requests like:

- `https://blackbeard.pirate/`
- `https://captain.pirate/posts`

The gateway extracts the hostname label and resolves the Pirate profile in the app/API layer.

Current repo assets for that path:

- `pirate-web/src/worker-public.ts`
- `services/gateway/hns-public/src/server.ts`

The Cloudflare worker remains the app-side reference renderer.
The VPS gateway service is the actual `.pirate` web entrypoint.

Its job is:

1. read `Host`
2. extract the second-level label
3. call the public profile lookup API
4. render the public profile surface
5. redirect renamed handles when needed
6. link back to canonical web app routes on `pirate.sc`

## API Contract

The existing public lookup API already matches this model:

- `GET /public-profiles/:handleLabel`

That endpoint remains the single source of profile resolution for both:

- `pirate.sc/u/<handle>`
- `https://<label>.pirate`

Do not build a second identity lookup stack just for HNS.

## Canonical URL Behavior

Recommended rule:

- canonical application URL: `https://pirate.sc/u/blackbeard.pirate`
- HNS mirror URL: `https://blackbeard.pirate`

The HNS route is a public identity entrypoint, but the app route remains the universal fallback and stable web URL.

That means the HNS surface should usually:

- render the public profile directly
- provide an `Open in Pirate` action pointing to `pirate.sc/u/<handle>`

It does not need to redirect every request back to `pirate.sc`.

## Browser / Resolver Split

Two runtime paths may exist:

1. Standard web browsers
- use `pirate.sc/u/<handle>`

2. HNS-capable browsers or Pirate-managed HNS browser/runtime
- can resolve `https://<label>.pirate`

The existing `docs/hns-integration-workplan.md` covers the browser-side HNS path.

This document only defines how the public-profile gateway should behave once hostname resolution reaches Pirate infrastructure.

Stable live verification fixtures are documented in:

- `docs/hns-public-profile-fixtures.md`

## Recommended Implementation Order

1. Keep `pirate.sc/u/<handle>` as the canonical public route in `pirate-web`
2. Keep `worker-public.ts` unattached to `pirate.sc` routes
3. Deploy the VPS HNS public gateway
4. Configure PowerDNS wildcard web routing for `*.pirate`
5. Point that wildcard at the public profile gateway
6. Validate:
- existing handle
- missing handle
- renamed handle redirect
- suspended handle
- `Open in Pirate` back-link

## What Not To Do

- do not create `*.pirate.sc` public profile routing
- do not generate one DNS record per user handle
- do not build a second profile datastore for HNS
- do not make HNS the only public profile path
- do not treat `name.pirate` resolution as a Cloudflare subdomain problem

## Acceptance Criteria

The HNS public profile path is correct when:

- `pirate.sc/u/blackbeard.pirate` works for all users
- `blackbeard.pirate` works through HNS infrastructure without per-user DNS records
- both surfaces resolve through the same public profile lookup API
- renamed handles redirect cleanly on both surfaces
- PowerDNS only manages the root zone plus wildcard web routing, not individual user records
