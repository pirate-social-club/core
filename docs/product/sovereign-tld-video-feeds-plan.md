# Sovereign TLD Video Feeds — Converged Plan (2026-08-10)

Status: **converged and adopted.** Every community TLD gets a TikTok-style
vertical video feed at its apex, with the thread app on `app.<root>`. Verified
against `origin/main` across web, api, and core through a three-round
adversarial audit; all disputed findings resolved by reading current code.

Verified baseline (exact `origin/main` SHAs at verification time; the audited
files were re-checked unchanged through these refs):

| Repo | SHA |
| --- | --- |
| web | `81fe23562a39f703b16c0a36ffe3caffbdb76239` |
| api | `4033e737e3a6cc0af3840250f218a96d55038225` |
| core | `c502b59943cfb436e5c85d8e5e0db0b57b41e80d` |

Note: the pirate-workspace primary `web` and `api` checkouts are
stale/divergent salvage branches — implementation worktrees must branch from
fresh `origin/main`.

## Route contract

| URL | Serves | Notes |
| --- | --- | --- |
| `pirate.sc/` | Global video feed | Already the primary Home surface |
| `<root>/` | Sovereign community video feed | Video-first; never preference-dependent |
| `app.<root>/` | Sovereign threads | Wallet-enabled application origin |
| `<root>/p/:id` · `app.<root>/p/:id` | Sovereign-scoped post detail | Foreign post → 404; never a global fallback |
| `pirate.sc/c/<slug>` | Redirect only | HTTP 302 by community `default_surface`; exact bare route |
| `pirate.sc/c/<slug>/videos` | Explicit community video surface | Self-canonicalizing |
| `pirate.sc/c/<slug>/threads` | Explicit community thread surface | Self-canonicalizing |
| `home.<root>` | Dropped | Reserve `home` in web + core (currently a squattable profile handle) |

Both surfaces carry a persistent **Videos | Threads** switch — host change on
the TLD, path change on the canonical site, implemented as ordinary deep links
to the same `/p/:id`. SEO canonical is always `pirate.sc/p/:id`; sovereign
hosts are presentations, not indexing targets (HNS roots may not resolve for
crawlers, can be transferred or deactivated).

## `default_surface`: persistence, administration, invariant

The read contract alone is not enough; the setting must be authoritative:

- Authoritative control-plane field, backfilled/defaulted to `threads` for
  all existing communities.
- Authorized owner/operator mutation endpoint plus community settings UI.
- Validation and generated contract/OpenAPI updates.
- Projected into the **base** `GET /public-communities/:id` response (shared
  community-summary DTO, reused by the feed payload). The redirect decision
  must never fetch the video feed just to decide.
- Mutation emits a cache-purge event (see cross-layer purge below).

Invariant: **`default_surface == videos` requires `video_feed == enabled`.**
Enforced fail-safe at read time: if `video_feed` is disabled, the bare
canonical route falls back to `/threads` regardless of the stored value.
Disabling `video_feed` should additionally reset the stored default to
`threads` (atomic with the disable) so state and behavior agree.

## Redirect rules for `/c/<slug>`

- **HTTP 302 only** (temporary; `default_surface` is mutable — a cached 301
  would pin visitors to a stale surface).
- Match the exact bare route. `/mod`, `/submit`, `/bookings`, `/videos`,
  `/threads`, and all other subroutes bypass the decision.
- Two layers, one data source:
  - **SSR worker** resolves the public-community payload and returns the 302.
  - **Client:** the synchronous router (`router.ts`) cannot consult async
    data — it returns a `community-landing` route kind for exact `/c/:slug`;
    the route **loader/renderer** reads the same cached public-community
    query and performs a replace-navigation to the explicit path. Subroutes
    never enter this loader.
- Preserve the query string; fragments survive 3xx natively.
- Caching: cache **queryless** redirects only (short TTL, tagged
  `community:<id>`); query-bearing redirects are emitted `no-store` — each
  query produces a distinct `Location`, and caching them invites
  cache-cardinality abuse.
- Cross-layer purge is new work: the web layer currently has **no**
  Cache-Tag/CDN response plumbing, and API-side `community:<id>` purges do
  not touch web SSR or redirect responses. Step 3 must add the web-side
  tagging and wire the API mutation's purge event through to it, with a test
  proving a `default_surface` change invalidates config, redirect, SSR HTML,
  and feed entries.
- Existing communities default to `threads`; new internal navigation links to
  explicit paths; the bare route renders nothing and carries no canonical tag.

## Decisions adopted

**Feed corpus is viewer-neutral; auth is an overlay.** Everyone reads
`GET /public-communities/:id/feed/videos` (CDN-cached under the
`/public-communities/*` auto-allowlist, `community:`/`post:` purge tags,
no `Vary: Accept`, degraded-empty bodies never cached). Signed-in visitors add
a separate `no-store` viewer overlay for votes, membership, and gate state.
This sidesteps the non-member 404 membership mask (`requireMemberAccess`) and
keeps the cache unfragmented by authentication.

**Projection-backed feed source, new public entrypoint.** The control-plane
projection queries (`listVideoHomeFeedProjectionRows` /
`listBestVideoHomeFeedProjectionRows`, `home-feed-service.ts:356+`) already
filter `post_type = 'video'` and accept a `communityIds[]` — but they are
module-private and `communityIdsOverride` is debug-pipeline-only. Build a real
service entrypoint with scope-aware selection: community diversity cap
disabled at N=1, author cap an explicit product decision, hydration backfill
and cursor continuity tested under the changed policy. Do NOT bolt filtering
onto `listPublishedLocalizedPosts` (no video predicate; best/top is a 10k-row
in-memory offset slice).

**Branding by constrained tokens, no wordmark uploads at launch.** Community
avatar + rendered display name, accent color (contrast-checked), theme,
header style, tagline — riding the shared community-summary DTO so SSR paints
community identity on the first frame:

```jsonc
{
  "community": {
    "id": "…", "route_slug": "…", "display_name": "…",
    "avatar_ref": "…", "banner_ref": "…",
    "branding": { "accent_color": "…", "theme": "…", "header_style": "…", "tagline": "…" },
    "default_surface": "videos" // or "threads"
  },
  "items": [], "next_cursor": null
}
```

Marks are runtime community-media references, never bundled imports (the SSR
worker build inlines imports as data URIs — see the 922KB logo incident). No
arbitrary CSS, HTML, JS, or external fonts. Platform attribution moves to
quiet chrome ("Powered by Pirate" in drawer/footer), not the masthead.

**Impersonation boundary (launch-critical).** Wallet, login, signing, payment,
and permission dialogs are unthemeable platform chrome with explicit origin
information and a fixed trust mark. Reserved-name filtering exists but is
secondary — Unicode confusables defeat name blocking; the unthemeable auth
boundary is the security guarantee. Community branding lives on wallet-bearing
origins (`web#1046`), so this is safety, not polish.

**Dedicated `video_feed` surface flag.** Does not inherit the `thread_cards`
machine-access opt-out. When disabled: branded "video feed unavailable" state
plus a Threads deep link — never a fallback to global video. TLD
activation/configuration warns when the apex video surface is disabled.

**Scorer accepted as-is for launch.** Behavioral features are constant on null
stats, but explicit engagement (0.10), downvote share (−0.35), and freshness
(0.15) rank today. Behavioral ingestion is post-launch.

## Launch-critical path

1. **Isolation and trust.** Thread namespace context through every route;
   enforce `post.community == forwarded community` with 404 on mismatch,
   tested. Forwarder trust today: web accepts context given a valid shared
   token **or** a trusted source IP (either alone suffices) after
   internal-header sanitization at the gateway. Target: production requires a
   valid timestamped HMAC (over host, path, method, root, community) **and**
   a trusted forwarder source — neither mechanism independently authorizes
   context; fail closed when the key is absent. Ship with key rotation,
   defined clock-skew tolerance, canonical input encoding, and replay-window
   tests. Reserve `home` in web and core.
2. **Community video endpoint + `default_surface` administration.**
   Projection-backed `/public-communities/:id/feed/videos` with working v1/v2
   cursors and scope-aware selection. Community summary, branding tokens, and
   `default_surface` join the shared DTO; the persistence/mutation/invariant
   work above lands here (control-plane field, backfill, mutation endpoint,
   settings UI, contract regen, purge event).
3. **Web wiring.** New sovereign-video route kind across worker, router,
   shell, and both renderers. The `community-landing` route kind + async
   loader redirect for `/c/<slug>` (SSR 302 + client replace-navigation) plus
   explicit `/videos` and `/threads` routes. Web-side cache-tag plumbing and
   the cross-layer purge path, verified by test. Community-scoped query keys
   everywhere (TanStack cache restore shows the wrong feed otherwise), SSR
   branding + bootstrap preload extended past the hardcoded
   `/feed/home/videos/public` + `route.kind === "home"` (`worker.tsx:124`,
   `:443`; `document.tsx:41`), SEO canonicals, and the signed-in viewer
   overlay. Empty sovereign feed shows a branded empty state with a Threads
   link — never the global homepage.
4. **Gateway resilience.** Namespace-resolution cache, timeout, request
   coalescing, stale-if-error, and downstream gzip/zstd (today: uncached
   timeout-less `/public-namespaces/:root` per imported-root web request,
   forced `accept-encoding: identity`, no Caddy `encode`). Capacity testing
   must include sustained `api.pirate` byte streaming, concurrent range
   requests, disconnect handling, and backpressure — HNS clients stream video
   bytes through the same single-process gateway even though feed JSON skips
   namespace resolution.
5. **Media authorization and playback.** Replace the per-range-request
   `instr(media_refs_json, …)` publication scan on the artifact content route
   (`fetchPublishedPublicSongArtifactContent`) with an indexed public-media
   grant keyed by community and upload; cache authorization independently of
   byte range; add upload-time faststart validation or transmuxing; decide
   progressive MP4 vs HLS/DASH. Also run the legacy-zone DNS reconciliation
   for zones provisioned before explicit `app.<zone>` A+TLSA management.

Post-launch: behavioral ranking ingestion, the independent public-pagination
fix (`next_cursor: null` at `public-communities.ts:754`), wordmark uploads.

## Findings ledger

Kept so it isn't re-litigated. Rulings settled across the audit rounds:

| Claim | Ruling | Resolution |
| --- | --- | --- |
| Deep routes not sovereign-scoped | **Confirmed** | Context consumed only at `pathname === "/"` in three synchronized places; context accepted on token-or-IP trust |
| No community-scoped video source | **Confirmed** | Fix via private projection queries (new entrypoint), not the generic community-posts listing |
| Public pagination disabled | **Confirmed** | `next_cursor: null` at the route boundary; contract-reset fallout; fix independently |
| Feed traffic hammers namespace resolution | **Corrected** | API traffic pins `api.pirate` → reserved proxy path; the uncached lookup affects imported-root web requests only; `request-host-mirror.ts` rewrites media refs (emitted no-store) |
| No anonymous video delivery path | **Corrected** | The song-artifact content route serves video kinds (`primary_video`, `canvas_video`, `preview_video`) anonymously with Range; its authorization scan is the real defect |
| No explicit `app.<zone>` DNS record | **Corrected** | Current `pdns-store.ts buildManagedRrsets` manages app A + TLSA together; earlier read was from a stale checkout. Legacy zones need reconciliation |
| `home.<root>` half-supported | **Partial** | Web accepts only `.pirate`/bare/`app.<root>`; `home` absent from reserved sets → profile-handle collision. Dropped entirely; reserve `home` |
| Scorer inert | **Overstated** | Behavioral features constant, but engagement / downvote / freshness rank today |
