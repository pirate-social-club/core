# Onboarding Reddit Deploy Smoke Checklist

Use this after a `pirate-web` or `pirate-api` deploy that could affect:

- `POST /onboarding/reddit-verification`
- `POST /onboarding/reddit-imports`
- `GET /onboarding/reddit-imports/latest`
- `GET /onboarding/global-handle-availability`
- `POST /profiles/me/global-handle/rename`

## Goal

Confirm that the deployed web build points at the intended API origin and that the onboarding route surface is alive in the target environment.

This is a smoke check, not a full E2E test.

## 1. Confirm the target API origin

Use the environment-specific `VITE_PIRATE_API_BASE_URL` that was used for the web build.

- `local-sqlite`: `http://127.0.0.1:8787`
- `staging`: `https://api-staging.pirate.sc`
- `dev`: use the real deployed dev API origin from the actual `.env.dev`
- `production`: use the real deployed production API origin from deploy-time config

Do not treat `.env.dev.example` or `.env.production.example` as proof of the live origin. Those files are templates.

## 2. Run the route-surface smoke script

Unauthenticated route-surface check:

```bash
cd pirate-web
rtk bun run smoke:onboarding -- --url <api-base-url>
```

This verifies:

- `GET /health` returns `200`
- preflight works for `POST /onboarding/reddit-verification`
- protected onboarding/profile routes return `401` instead of `404`

Optional authenticated check:

```bash
cd pirate-web
rtk bun run smoke:onboarding -- --url <api-base-url> --token <pirate-access-token>
```

This additionally verifies:

- `GET /onboarding/status` returns `200`
- `GET /onboarding/global-handle-availability` returns `200`

The script intentionally avoids authenticated mutating calls so it does not create Reddit verifications or rename handles in a shared environment.

## 3. Browser smoke

Use a real account in the target environment.

1. Sign in.
2. Open `/onboarding`.
3. Enter a Reddit username and click `Continue`.
4. Confirm the code appears.
5. Place the code on Reddit and click `Continue` again.
6. Confirm the flow reaches the username step.
7. Confirm handle availability responds when typing.
8. Claim the handle.
9. Confirm the communities step renders and `Done` exits onboarding.

## 4. Minimum pass criteria

- Web is using the intended API origin for the target environment.
- `smoke:onboarding` passes.
- Browser smoke reaches `username` after Reddit verify.
- Browser smoke reaches `communities` after handle claim.

If any protected onboarding route returns `404`, treat that as an environment wiring failure, not a user-data issue.
