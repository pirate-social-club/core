# TUI Scrobble Player

Status: draft (deferred)

Related docs:

- [scrobbles.md](./scrobbles.md)
- [artist-catalog.md](./artist-catalog.md)
- [user.md](./user.md)
- [../contracts/overview.md](../contracts/overview.md)

## Purpose

This doc captures the design and gap analysis for adding a local music player with scrobble submission to `pirate-tui`.

It is not an active implementation target. Revisit when scrobble product work resumes.

## Desired Flow

1. User selects one or more local folders containing audio files
2. TUI scans folders, extracts metadata, builds a browseable track list
3. User browses/searches tracks, plays them
4. After a listen passes a validity threshold, the TUI submits a scrobble to the Pirate API
5. Scrobble enters the standard async anchor pipeline (queued → anchoring → anchored)

## Current State

### pirate-v2 scrobble infrastructure

The control-plane scrobble pipeline is designed and migrated:

- `scrobble_ingest_events` table with idempotency, anchor status tracking, wallet resolution
- `scrobble_anchor_batches` and `scrobble_anchor_batch_items` for batch onchain publication
- `track_anchor_state` for track registration lifecycle
- `projection_outbox` for materialized read models

Source: `db/control-plane/migrations/0003_control_plane_scrobbles.sql`

### pirate-v2 API gap

The v2 OpenAPI spec defines scrobble endpoints:

- `POST /scrobbles` — submit a scrobble (202 accepted, async anchor)
- `GET /users/{user_id}/scrobbles` — read user scrobbles with cursor pagination

**These endpoints are not implemented in `pirate-api` yet.** The v2 API routes (`pirate-api/services/api/src/routes/`) cover: auth, communities, feeds, jobs, onboarding, posts, profiles, users, verification. No music or scrobble routes exist.

The v2 API has no track registration endpoint either (`POST /tracks` is in the spec but not implemented).

### pirate-tui current state

- Go/Bubble Tea v2 app with routes: Home, Search, Account
- Auth: `PIRATE_ACCESS_TOKEN` env var, stored session in `~/.config/pirate/session.json`, local dev signup. No Privy integration. No desktop scrobble session flow.
- API client (`internal/api/client.go`): covers onboarding, feed, communities, profiles, reddit verification/import only. No scrobble or track endpoints.
- No audio engine, no music library, no folder scanning, no metadata extraction, no track DB.

### Legacy reference (LEGACY-DO-NOT-USE)

The legacy `pirate-desktop` (Rust/GPUI) and `pirate-api` had a fully working scrobble pipeline:

**API route** (`pirate-api/services/api/src/routes/music/scrobble-route.ts`):
- `POST /scrobble` with Privy or desktop-session auth
- Story chain `ScrobbleV4` contract interaction: `scrobbleBatch` or `registerAndScrobbleBatch`
- PKP (Lit Action) operator with direct-key fallback
- Server-side track ID derivation: MBID → kind 1, ipId → kind 2, publisher+title+album → kind 3
- Idempotency via `scrobble_idempotency` table with SHA-256 request hash
- Artist name persisted to `scrobble_track_artist` for later queries

**Desktop scrobble session auth** (`desktop-scrobble-session-route.ts`):
- Bootstrap → Exchange → Refresh → Revoke flow
- PKCE code challenge, device key proofs, token families
- Session stored in `desktop_scrobble_sessions` + `desktop_scrobble_refresh_tokens`
- Designed for pairing a headless desktop client with a web-authenticated session

**Desktop client** (`pirate-desktop/src/scrobble.rs`, `scrobble/privy.rs`):
- Sends `POST /api/music/scrobble` with desktop session headers (`x-pirate-desktop-session`, `x-pirate-desktop-access-token`)
- Handles 401 with session refresh retry
- Derives idempotency key from SHA-256 of scrobble payload
- Delegated onchain writes via session key authorization

**Audio engine** (`pirate-desktop/src/audio.rs`):
- symphonia (decode) + cpal (output) + rubato (resample) + ringbuf (lock-free)
- Background thread with mpsc command channel (play, pause, resume, seek)
- `AudioHandle` with `Arc<Mutex<PlaybackState>>` for UI reads

**Music library** (`pirate-desktop/src/library.rs`, `music_db/`):
- Folder scanning with `walkdir` + `lofty` metadata extraction
- Supported formats: mp3, m4a, flac, wav, ogg, aac, opus, wma
- Metadata: title, artist, album, duration, MBID, ipId, cover art
- SQLite track DB with incremental scan (file size + mtime cache)
- Virtualized track list with sort and search
- Artist/album detail drill-down
- Scrobble triggered after track plays past a duration threshold
- `track_started_at_sec` + `last_scrobbled_key` for scrobble timing

## Implementation Layers

| Layer | What | Go options |
|-------|------|-----------|
| Folder scan | Walk dir, filter audio extensions, read tags | `github.com/dhowden/tag`, `github.com/wtolson/go-taglib`, or `github.com/bogem/id3v2` |
| Track DB | Local SQLite for scanned tracks | `modernc.org/sqlite` (pure Go, no CGO) |
| Audio playback | Decode + output | `github.com/gopxl/beep` or `github.com/hajimehoshi/oto` |
| Scrobble client | `POST /scrobbles` with bearer token | `net/http` (extend existing `internal/api/client.go`) |
| Scrobble logic | Track play duration, submit after threshold | Pure Go |

## Auth Design Decision

The TUI's current auth is a simple bearer token (env var or stored session). The legacy desktop used a complex bootstrap→exchange→refresh flow with PKCE and device proofs, designed for pairing with a web session.

Options for the TUI:

### Option A: Reuse existing TUI session

The TUI already has a working session (`PIRATE_ACCESS_TOKEN` or stored session). The v2 API's scrobble endpoint (when built) would accept standard bearer auth, same as all other endpoints.

Pros: simplest path, no new auth flows, consistent with existing TUI patterns.
Cons: requires the v2 API scrobble route to accept the same auth as other routes (not Privy-specific or desktop-session-specific).

### Option B: Device code / OOB flow

TUI displays a short code, user visits a URL in a browser to authorize, TUI polls for the token.

Pros: no token copy-paste, familiar pattern (GitHub CLI, etc.).
Cons: more implementation work, needs a new API endpoint for device code issuance + polling.

### Option C: Legacy desktop-scrobble-session bootstrap

Reuse the bootstrap→exchange→refresh flow from the legacy desktop.

Pros: proven, handles refresh and revocation.
Cons: designed for paired web app sessions, not standalone TUI use; overengineered for TUI needs; the v2 API doesn't have these routes either.

**Recommendation:** Option A for the initial build. The TUI session already works. If Privy-gated features are needed later, add a device-code flow then.

## Prerequisites (Before TUI Work)

1. **`POST /scrobbles` route in pirate-api** — the v2 API needs a scrobble submission endpoint that accepts standard bearer auth and writes to `scrobble_ingest_events`. This is the single hard dependency.
2. **`POST /tracks` route in pirate-api** (or track resolution inside the scrobble route) — the scrobble endpoint needs to resolve or create a `track_id` before ingesting. The legacy API did this inline; the v2 API can do the same.
3. **Scrobble anchor worker in pirate-api** — accepted scrobbles need to be batched and anchored onchain. The DB schema supports this; the worker code does not exist in v2 yet.

## Open Questions

- Should the TUI do local track ID derivation (MBID/ipId/title → kind + payload → trackId hash) or send raw metadata and let the API derive the track ID? Legacy did it server-side; the TUI could do it locally to enable offline queueing.
- What listen-validity threshold should the TUI use? (Legacy desktop scrobbled after the track played past ~50% or 4 minutes, whichever came first, but this was never formally spec'd.)
- Should the TUI support offline scrobble queueing (submit when connectivity returns)?
- Does the TUI need the full `registerAndScrobbleBatch` path, or can it assume tracks are pre-registered?
- Cover art extraction: is it worth the complexity in a TUI, or should the TUI be text-only for tracks?
