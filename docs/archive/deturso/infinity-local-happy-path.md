# Infinity Local Happy Path

This is the current known-good operational path.

Use this runbook when you need a working local Infinity community with the first-text-post gate enabled.

## Outcome

After this runbook:

- API is running in `local-sqlite`
- web is running against the local API
- Infinity exists at `/c/infinity`
- the first Infinity text post requires Very
- later Infinity text posts are allowed without re-running the first-post gate

## Prerequisites

- API checkout available at `${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}`.
- Web checkout available at `${PIRATE_WEB_DIR:-/home/t42/Documents/pirate-workspace/web}`.
- `$PIRATE_API_DIR/.dev.vars.example` copied to `.dev.vars` in the API checkout.
- required local secrets filled in

## 1. Reset the local API state

```bash
PIRATE_API_DIR="${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}"
cd "$PIRATE_API_DIR"
rtk bun run dev:local:reset -- --yes
```

This recreates:

- the local control-plane DB at `TURSO_CONTROL_PLANE_DATABASE_URL`
- the local community DB root at `LOCAL_COMMUNITY_DB_ROOT`

## 2. Seed the Infinity user fixture

```bash
cd /home/t42/Documents/pirate-workspace/core
export PIRATE_API_DIR="${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}"
rtk bash -lc 'set -a; source "$PIRATE_API_DIR/.dev.vars"; set +a; CONTROL_PLANE_DATABASE_URL="$TURSO_CONTROL_PLANE_DATABASE_URL" rtk bun scripts/control-plane/seed-control-plane-fixtures.ts --database-url-env CONTROL_PLANE_DATABASE_URL --user-id usr_infinity_01 --subject infinity-subject-01 --handle infinitytester --namespace-label infinity --reddit-username infinitypilot --issuer pirate-dev-upstream'
```

## 3. Bootstrap the Infinity community

```bash
cd /home/t42/Documents/pirate-workspace/core
export PIRATE_API_DIR="${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}"
rtk bash -lc 'set -a; source "$PIRATE_API_DIR/.dev.vars"; set +a; CONTROL_PLANE_DATABASE_URL="$TURSO_CONTROL_PLANE_DATABASE_URL" rtk bun scripts/community/bootstrap-community-slice.ts --database-url-env CONTROL_PLANE_DATABASE_URL --community-db /tmp/pirate-community-dbs-live/community-cmt_infinity_01.db --community-id cmt_infinity_01 --user-id usr_infinity_01 --display-name Infinity --namespace-verification-id nv_infinity_usr_infinity_01 --posting-unique-human-provider very --namespace-label infinity'
```

This produces a local operational Infinity community with:

- `community_id = cmt_infinity_01`
- route ref `infinity`
- `text` posting gate requiring `unique_human.provider = very`
- `first_post_only = true`

## 4. Start the API

```bash
PIRATE_API_DIR="${PIRATE_API_DIR:-/home/t42/Documents/pirate-workspace/api/services/api}"
cd "$PIRATE_API_DIR"
rtk bun run dev:local-sqlite
```

Expected startup banner:

```text
pirate-api mode=local-sqlite
  control_plane_db = file:/tmp/pirate-control-plane-live.db
  community_db_root = /tmp/pirate-community-dbs-live
```

## 5. Start the web app

```bash
PIRATE_WEB_DIR="${PIRATE_WEB_DIR:-/home/t42/Documents/pirate-workspace/web}"
cd "$PIRATE_WEB_DIR"
rtk bun run dev:web
```

## 6. Validate the happy path

1. Open `http://localhost:5173/c/infinity`.
2. Open `http://localhost:5173/c/infinity/submit`.
3. If the user has not yet satisfied the first-post gate, complete the Very flow.
4. Create a text post.
5. Confirm the new post appears in the Infinity feed.

## Known Good Result

The local path is considered healthy when:

- `GET /communities/infinity` works
- `GET /communities/cmt_infinity_01/posts` works
- browser create-post redirects to `/p/<post_id>`
- the new post appears in `/c/infinity`

## Notes

- this path creates an operational local community, not a published registry community
- local Infinity uses file-backed emulation for both the control plane and the community DB
- this runbook is the baseline before touching staging
