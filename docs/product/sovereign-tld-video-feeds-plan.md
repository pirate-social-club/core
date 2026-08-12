# Sovereign TLD Community + Video Surfaces — Adopted Plan (amended 2026-08-12)

Status: **adopted, with the post-launch surface correction below.** Every
community TLD uses its apex as the public community identity and thread page;
its TikTok-style vertical video application lives at `app.<root>`. The
original launch shipped those two root surfaces in the opposite positions.
The correction was adopted after reviewing the live product: a bare community
domain should read as the community's front door, while `app.` is the
interactive application.

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
| `<root>/` | Public community/profile page with threads | Human-facing community front door; noindex; canonical → `pirate.sc/c/<slug>` |
| `app.<root>/` | Sovereign community video feed | TikTok-style application; wallet-enabled; never preference-dependent |
| `<root>/p/:id` | Public sovereign-scoped post detail | Foreign post → 404; canonical → `pirate.sc/p/:id` |
| `app.<root>/p/:id` | Interactive sovereign-scoped post mirror | Foreign post → 404; canonical → `pirate.sc/p/:id` |
| `pirate.sc/c/<slug>` | Redirect only | HTTP 302 by community `default_surface`; exact bare route |
| `pirate.sc/c/<slug>/videos` | Explicit community video surface | Self-canonicalizing |
| `pirate.sc/c/<slug>/threads` | Explicit community thread surface | Self-canonicalizing |
| `home.<root>` | Dropped | Reserve `home` in web + core (currently a squattable profile handle) |

Sovereign surfaces never carry a **Watch | Threads** toggle. The community
page has one localized **Open app** CTA to `app.<root>/`; tapping community
identity in the video application returns to `<root>/`. Creator identity
continues to open canonical `pirate.sc/u/<handle>` with cross-origin
signposting. Canonical `pirate.sc/c/<slug>/videos` and `/threads` remain two
views of the canonical community and keep their normal in-page navigation.

All HNS pages remain `noindex, nofollow`. Mainstream crawlers cannot resolve
Handshake names or validate their DANE-only certificates, and roots may be
transferred or deactivated. Community presentations canonicalize to
`pirate.sc/c/<slug>`; every sovereign post presentation canonicalizes to
`pirate.sc/p/:id`.

Surface isolation is explicit. The apex permits its exact root community page
and sovereign-scoped public post routes; wallet, settings, publishing,
moderation, global feeds, and foreign community routes are real HTTP 404s.
`app.<root>` owns the scoped video root plus wallet, settings, publishing,
moderation, bookings, and same-community app routes; global and foreign
community surfaces remain 404. Tests cover both permitted and rejected routes
using the same route-slug form emitted by the UI.

The routing swap and the production sovereign-context probe must ship in the
same web release. The probe fetches both origins through the real HNS gateway,
requires the scoped video bootstrap on `app.<root>` and its absence on the
apex, checks the Pirate canonicals and community branding on both HNS legs,
and contains a regression case that fails against the original apex-video
mapping. Sovereign SSR HTML currently has no CDN caching directive, so there
is no persisted page entry to purge; the production probe is the release-time
proof. If HTML caching is introduced later, this swap class requires a tagged
purge in the same release.

## `default_surface`: persistence, administration, invariant

The read contract alone is not enough; the setting must be authoritative:

`default_surface` governs only the canonical bare route
`pirate.sc/c/<slug>`. It never changes what `<root>/` or `app.<root>/` serves.

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

**Launch feed is viewer-neutral; the auth overlay is deferred.** Everyone reads
`GET /public-communities/:id/feed/videos` (CDN-cached under the
`/public-communities/*` auto-allowlist, `community:`/`post:` purge tags,
no `Vary: Accept`, degraded-empty bodies never cached). At launch, signed-in
visitors receive the same corpus without vote, membership, or gate state. A
post-launch ticket adds those fields through a true, separate `no-store`
viewer-overlay endpoint rather than recomputing the feed. This sidesteps the
non-member 404 membership mask (`requireMemberAccess`) and keeps the cache
unfragmented by authentication.

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
plus a link to the sovereign community root — never a fallback to global
video. TLD activation/configuration warns when the `app.<root>` video surface
is disabled.

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
   `:443`; `document.tsx:41`) and SEO canonicals. The scoped preload belongs
   to `app.<root>/`, never `<root>/`. Empty sovereign feed shows a branded
   empty state with a community-root link — never the global homepage.
   Community identity is rendered once in the sidebar/action rail rather than
   duplicated in the mobile media header.
   The signed-in viewer overlay is explicitly post-launch work and must be a
   separate `no-store` overlay endpoint, not a duplicate feed computation.
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
