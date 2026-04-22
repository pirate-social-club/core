# HNS Public Profile Fixtures

Purpose: record the historical stable live fixtures for Freedom/HNS public-profile verification.

Current launch state:

- the production control-plane app data was reset before launch
- these fixture rows no longer live in the production control-plane database
- do not depend on these handles for production smoke tests until a new launch fixture is intentionally created

## Canonical Fixture

- display name: `Blackbeard`
- canonical handle: `sable-harbor-4143.pirate`
- control-plane user id: `usr_fixture_blackbeard_hns`
- control-plane global handle id: `gh_fixture_blackbeard_hns`

Intended use:

- native Freedom/HNS verification
- `pirate.sc/u/:handle` public-profile verification
- public profile API verification
- OG/canonical metadata checks

Verification URLs:

- `https://api.pirate.sc/public-profiles/sable-harbor-4143`
- `https://pirate.sc/u/sable-harbor-4143.pirate`
- `https://sable-harbor-4143.pirate/`

Expected result:

- profile resolves
- page title contains `Blackbeard • Pirate`
- bio is `Stable HNS public-profile fixture for Freedom browser verification.`

## Redirect Fixture

- legacy handle: `blackbeard-legacy-fixture.pirate`
- canonical target: `sable-harbor-4143.pirate`

Intended use:

- old-handle redirect verification
- canonicalization behavior on both:
  - `pirate.sc/u/:handle`
  - `https://<label>.pirate/`

Verification URLs:

- `https://api.pirate.sc/public-profiles/blackbeard-legacy-fixture`
- `https://pirate.sc/u/blackbeard-legacy-fixture.pirate`
- `https://blackbeard-legacy-fixture.pirate/`

Expected result:

- API resolves successfully with:
  - `is_canonical = false`
  - `resolved_handle_label = sable-harbor-4143.pirate`
- public web route redirects to `https://pirate.sc/u/sable-harbor-4143.pirate`
- native HNS route redirects to `https://sable-harbor-4143.pirate/`

## Notes

- The normal product write path is still:
  1. `POST /auth/session/exchange`
  2. `PATCH /profiles/me`
  3. `POST /profiles/me/global-handle/rename`
- These fixtures were originally seeded directly in prod control-plane data because the prod upstream JWT signing secret was not available in the local checkout.
- They were removed during the pre-launch prod app-data reset.
- Do not reuse these handles for general manual testing or demos that mutate profile state.
