# Pirate Admin Token Operations

This runbook documents how `PIRATE_ADMIN_TOKEN` is created, stored, synced, and
used for production admin operations.

## What The Token Is

`PIRATE_ADMIN_TOKEN` is the v1 shared admin capability for privileged API
operations.

The API accepts it in the `x-admin-token` header. Most community/admin routes
also require `x-admin-as-user-id`, which tells the API which real user id the
admin action is acting as:

```bash
x-admin-token: $PIRATE_ADMIN_TOKEN
x-admin-as-user-id: usr_...
```

The API compares the supplied token against `env.PIRATE_ADMIN_TOKEN` with a
timing-safe hash comparison. If `PIRATE_ADMIN_TOKEN` is not configured in the
worker environment, admin-token auth is disabled.

## Source Of Truth

Production source of truth:

```text
Infisical env:  prod
Path:           /services/api
Secret:         PIRATE_ADMIN_TOKEN
```

The checked secret contract marks this as `required_for_production` in
`core/scripts/lib/infisical-env-contract.ts`.

Optional command-runner copy:

```text
Infisical env:  prod
Path:           /services/bot-runner
Secret:         PIRATE_ADMIN_TOKEN
```

That copy exists only so admin CLI jobs can run with a narrower secret path than
the full API runtime path. Until a narrower bot-runner token exists, it must
match `/services/api`.

## Cloudflare Runtime Secret

The deployed API worker does not read Infisical directly. Infisical is synced
into Cloudflare Worker secrets.

Runtime target:

```text
Worker: api-core
Secret: PIRATE_ADMIN_TOKEN
```

Cloudflare secrets are write-only from the CLI/dashboard. You can confirm a
secret exists, but you cannot read its value back from Cloudflare. This is why an
agent shell cannot recover the token after deployment unless Infisical is
explicitly injected for that command.

## Generate A Token

Generate a high-entropy token locally:

```bash
rtk openssl rand -base64 48
```

Acceptable alternative:

```bash
rtk openssl rand -hex 32
```

Do not use human-readable phrases, short UUIDs, or tokens copied from tests.

## Set Or Rotate In Infisical

Set the production API token:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk infisical secrets set PIRATE_ADMIN_TOKEN="$NEW_TOKEN" \
  --env prod \
  --path /services/api
```

If `/services/bot-runner` is in use, update it to the same value until a
narrower bot-runner token is implemented:

```bash
rtk infisical secrets set PIRATE_ADMIN_TOKEN="$NEW_TOKEN" \
  --env prod \
  --path /services/bot-runner
```

Then sync API Worker secrets from Infisical:

```bash
rtk infisical run --env prod --path /services/api -- \
  rtk ./scripts/infisical/sync-wrangler-api-secrets.sh \
  --api-dir /home/t42/Documents/pirate-workspace/api/services/api \
  --wrangler-env production
```

After syncing, deploy or redeploy the API worker so the current worker version
has the expected secret bindings.

## Use For One Production Command

Prefer command-scoped Infisical injection. Do not export the token into a long
lived shell.

Example: run the community DB migration backfill for one community:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk infisical run --env prod --path /services/api -- \
  rtk curl -sS -X POST \
    https://api.pirate.sc/communities/com_cmt_06c2ff60232d48d397c6d150e242a94d/admin/database-migrations \
    -H "x-admin-token: $PIRATE_ADMIN_TOKEN" \
    -H "x-admin-as-user-id: $PIRATE_ADMIN_AS_USER_ID"
```

`PIRATE_ADMIN_AS_USER_ID` is not a secret. Set it to the raw user id of the
operator account to attribute the action:

```bash
PIRATE_ADMIN_AS_USER_ID=usr_...
```

If the command needs both variables, set the acting user id inline without
printing the token:

```bash
PIRATE_ADMIN_AS_USER_ID=usr_... \
rtk infisical run --env prod --path /services/api -- \
  rtk curl -sS -X POST \
    https://api.pirate.sc/communities/com_cmt_06c2ff60232d48d397c6d150e242a94d/admin/database-migrations \
    -H "x-admin-token: $PIRATE_ADMIN_TOKEN" \
    -H "x-admin-as-user-id: $PIRATE_ADMIN_AS_USER_ID"
```

Expected response:

```json
{
  "community": "com_cmt_06c2ff60232d48d397c6d150e242a94d",
  "database_url": "libsql://...",
  "applied": 1,
  "skipped": 61
}
```

`applied: 0` with all migrations skipped is also successful if the database was
already current.

## Agent / AI Boundary

AI shells must not have standing Infisical auth and must not browse or dump
Infisical secrets.

For production incidents, a human operator may approve a single
`infisical run --env prod --path /services/api -- ...` command when:

- the exact command is reviewed first,
- stdout/stderr will not print raw secret values,
- the command is limited to the intended admin operation,
- the acting user id and target community id are recorded in the task log.

See `core/docs/control-plane/ai-infisical-boundary.md`.

## Verification

Check Infisical contract:

```bash
cd /home/t42/Documents/pirate-workspace/core
rtk bun scripts/infisical/check-infisical-env.ts --env prod
```

Check Cloudflare has the secret without revealing it:

```bash
cd /home/t42/Documents/pirate-workspace/api/services/api
rtk bunx wrangler secret list --env production
```

Run an admin health check with command-scoped injection:

```bash
PIRATE_ADMIN_AS_USER_ID=usr_... \
rtk infisical run --env prod --path /services/api -- \
  rtk curl -sS \
    https://api.pirate.sc/communities/admin/health \
    -H "x-admin-token: $PIRATE_ADMIN_TOKEN" \
    -H "x-admin-as-user-id: $PIRATE_ADMIN_AS_USER_ID"
```

## Rotation Checklist

1. Generate `NEW_TOKEN`.
2. Set `PIRATE_ADMIN_TOKEN` in `prod:/services/api`.
3. Set the same value in `prod:/services/bot-runner` if that path is active.
4. Sync Cloudflare API worker secrets from Infisical.
5. Redeploy API if needed.
6. Run `/communities/admin/health`.
7. Update any scheduled one-shot job docs that referenced the old token source.
8. Confirm no raw token was pasted into shell history, logs, tickets, or repo
   files.

## Current Limitations

- The admin token is shared and broad. It should be replaced with scoped admin
  tokens or signed operator sessions.
- `/services/bot-runner` currently reuses `PIRATE_ADMIN_TOKEN`; a narrower
  `BOT_RUNNER_ADMIN_TOKEN` should replace it.
- Cloudflare cannot reveal existing secret values. Infisical is the retrievable
  source of truth.
