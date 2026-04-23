# Pirate Analytics

Internal launch analytics dashboard for Pirate operators.

The browser never receives a Tinybird token. The React app calls `/api/dashboard`, and the Cloudflare Worker proxies scoped requests to published Tinybird endpoints.

## Local

```bash
rtk infisical run --env dev --path /services/api -- rtk bun run dev
```

Open `http://127.0.0.1:8788`.

## Deploy

Protect the deployed app with Cloudflare Access. Then set secrets:

```bash
rtk bunx wrangler secret put TINYBIRD_TOKEN
```

Optional vars:

- `SUPER_ADMIN_EMAILS`: comma-separated lower-case emails.
- `REQUIRE_ACCESS`: defaults to `true`; set to `false` only for local/private testing.

Deploy:

```bash
rtk bun run deploy
```
