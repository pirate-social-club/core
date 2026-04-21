# HNS Integration Workplan

Ship a Freedom fork where `https://app.pirate/` works out of the box through a bundled Handshake stack. Pirate itself stays a normal website. The browser change is "make HNS-backed HTTPS work," not "add Pirate-specific routing."

## Architecture Decisions

- **Selective proxy MVP**: only Handshake-like hosts go through the local HNS proxy. Conventional web stays on Chromium's normal TLS path.
- **Headless helper**: minimal Go binary extracted from Fingertip. No tray, no onboarding, no OS proxy/cert install.
- **Helper output contract**: newline-delimited JSON on stdout. CA PEM written to a fixed file path. No HTTP control API.
- **Node owns restart policy**: helper exits on fatal hnsd failure. `hns-manager.js` handles restart with bounded retries.
- **Source ownership**: short-term extraction from `pirate-tui/fingertip`. Long-term move under `freedom-browser`.
- **MVP platforms**: macOS + Linux only. Defer Windows.
- **Home page**: replace with HNS bootstrap/status page that subscribes to service registry and auto-redirects to `https://app.pirate/` once ready. Do not make `homeUrl` dynamic.

## Revised Architecture

### 1. Headless Helper (`fingertipd`)

Build a minimal Go helper from Fingertip's runtime pieces only.

**Keep from Fingertip:**
- hnsd supervision: `pirate-tui/fingertip/internal/resolvers/proc/hns.go:15`
- resolver/proxy construction: `pirate-tui/fingertip/main.go:335`
- CA creation/loading: `pirate-tui/fingertip/internal/config/config.go:54`

**Drop from Fingertip:**
- tray UI
- onboarding/status web pages
- OS auto-proxy install
- system cert install
- autostart
- helper-side restart loop

**Helper output contract:**
- Write CA PEM to a fixed file in its runtime dir
- Emit newline-delimited JSON status events on stdout

**Example stdout events:**
```json
{"type":"ready","proxyAddr":"127.0.0.1:9590","caPath":".../hns-ca.pem"}
{"type":"sync","synced":false,"height":12345}
{"type":"sync","synced":true,"height":12399}
{"type":"error","message":"..."}
```

### 2. Source and Binary Placement

- Binary artifacts: `freedom-browser/hns-bin/<os>-<arch>/fingertipd` and `hnsd`
- Short-term source: extract from `pirate-tui/fingertip`
- Long-term source: move helper source under `freedom-browser`

### 3. Main-Process Manager

Create `freedom-browser/src/main/hns-manager.js`.

**Exports:**
- `startHns()`
- `stopHns()`
- `getHnsStatus()`
- `registerHnsIpc()`

**Responsibilities:**
- spawn helper binary
- parse stdout JSON events
- update internal state
- publish `hns` into service-registry
- configure/unconfigure proxy via `session.setProxy()`
- configure certificate verification via `session.setCertificateVerifyProc()`
- restart on crash with bounded retries

**Mirror:** `freedom-browser/src/main/bee-manager.js:304`

### 4. Registry and Settings

**Settings** (`freedom-browser/src/main/settings-store.js:19`):
- add `enableHnsIntegration: false`
- add `startHnsAtLaunch: true`

**Service Registry** (`freedom-browser/src/main/service-registry.js:1`):
- add `hns` entry with fields: `api`, `proxy`, `mode`, `statusMessage`, `synced`, `height`

**IPC Channels** (`freedom-browser/src/shared/ipc-channels.js:3`):
- `HNS_START: 'hns:start'`
- `HNS_STOP: 'hns:stop'`
- `HNS_GET_STATUS: 'hns:getStatus'`
- `HNS_STATUS_UPDATE: 'hns:statusUpdate'`

**Preload** (`freedom-browser/src/main/preload.js:226`):
- expose `window.hns.start()`
- expose `window.hns.stop()`
- expose `window.hns.getStatus()`
- expose `window.hns.onStatusUpdate()`

### 5. Proxy Strategy: Selective Proxy MVP

Use PAC-based host routing so only Handshake-like hosts go through letsdane. Conventional web stays on Chromium's default TLS path.

**PAC logic:**
- Proxy single-label hosts (no dot) through letsdane
- Optionally proxy known Handshake patterns
- Bypass: localhost, 127.0.0.1, ::1, loopback range

**Implementation:**
- Generate a small PAC string in `hns-manager.js` using the helper's proxy address
- Set via `session.setProxy({ pacScript })` when HNS starts
- Clear proxy config when HNS stops

### 6. Certificate Verification

Depends on proxy strategy. With selective proxying:
- Only HNS-routed HTTPS gets local-CA-signed certificates
- Everything else stays on Chromium default trust
- `session.setCertificateVerifyProc()` must:
  - Trust the local CA for proxied HNS traffic
  - Fall through to default verification (`callback(-3)`) for everything else
- Read the CA PEM from the helper's fixed output path
- Parse into an `X509Certificate` object for comparison

### 7. Renderer Changes

**`freedom-browser/src/renderer/lib/url-utils.js:45`:**
- add `looksLikeHnsHostInput(str)` — detects `app.pirate`, `app.pirate/`, `app.pirate/abc`, and other HNS-style host inputs
- add `normalizeHnsHostInput(str)` — converts to `https://app.pirate/`, `https://app.pirate/abc`
- both gated on HNS integration being enabled

**`freedom-browser/src/renderer/lib/navigation.js:852` (submit handler):**
- before ENS/BZZ/IPFS fallback, normalize HNS-style hostnames when HNS is enabled
- `app.pirate` → `https://app.pirate/`
- `app.pirate/abc` → `https://app.pirate/abc`

**`freedom-browser/src/renderer/lib/navigation.js:487` (loadTarget):**
- add the same normalization path for programmatic calls
- otherwise raw `pirate` still gets dropped as invalid

**Rejection criteria for HNS host detection:**
- strings containing spaces
- strings starting with uppercase or containing uppercase after first char
- strings that are pure numbers
- strings that look like file paths (e.g., `/etc/passwd`)
- strings that match existing protocol prefixes (`bzz:`, `ipfs:`, `rad:`, etc.)

### 8. Startup and Home Flow

Replace the current home page with an HNS bootstrap/status page.

- Keep `freedom://home` as the internal bootstrap page
- Page subscribes to `serviceRegistry.onUpdate`
- Behavior:
  - HNS disabled: show normal browser home or settings prompt
  - HNS starting/syncing: show status (block height, sync progress)
  - HNS ready: auto-redirect to `https://app.pirate/`
- Do not make `homeUrl` in `page-urls.js` dynamic

### 9. Request Rewriter Interaction

- Bee/IPFS/Radicle traffic is local and must not be proxied into HNS
- PAC bypass must cover loopback generally (`127.0.0.0/8`, `localhost`, `::1`)
- `freedom-browser/src/main/request-rewriter.js` must continue working unimpeded

### 10. Packaging

- Add `hns-bin/` beside `bee-bin/`, `ipfs-bin/`, `radicle-bin/`
- Bundle: `fingertipd` + `hnsd`
- Start with macOS + Linux
- Defer Windows until binary/dependency story is clean
- Add to `package.json` `build.extraResources` like existing services

## Concrete File Plan

### Create

| File | Repo |
|------|------|
| `cmd/fingertipd/main.go` | pirate-tui |
| `src/main/hns-manager.js` | freedom-browser |
| `src/main/hns-manager.test.js` | freedom-browser |
| `hns-bin/<os>-<arch>/fingertipd` | freedom-browser |
| `hns-bin/<os>-<arch>/hnsd` | freedom-browser |
| `src/renderer/pages/hns-status.html` | freedom-browser |

### Edit

| File | Repo | Change |
|------|------|--------|
| `src/main/index.js` | freedom-browser | register HNS IPC, start/stop on launch/quit |
| `src/main/service-registry.js` | freedom-browser | add `hns` entry |
| `src/main/settings-store.js` | freedom-browser | add `enableHnsIntegration`, `startHnsAtLaunch` |
| `src/main/preload.js` | freedom-browser | expose `window.hns` bridge |
| `src/shared/ipc-channels.js` | freedom-browser | add HNS IPC channels |
| `src/renderer/lib/url-utils.js` | freedom-browser | add `looksLikeSingleLabelHost`, `normalizeHnsHostInput` |
| `src/renderer/lib/navigation.js` | freedom-browser | normalize before loadTarget and in submit handler |
| `src/renderer/lib/navigation-utils.js` | freedom-browser | add HNS protocol icon type |
| `src/shared/internal-pages.json` | freedom-browser | add hns-status page |
| `package.json` | freedom-browser | extraResources for hns-bin |

## Execution Order

1. Extract and build `fingertipd` from `pirate-tui`
2. Add `hns-bin/` packaging target in `freedom-browser`
3. Implement `hns-manager.js`
4. Add registry, settings, IPC, and preload plumbing
5. Implement selective proxy via PAC
6. Implement certificate verification
7. Fix renderer normalization and navigation
8. Replace startup/home with bootstrap status page
9. Add UI status surface
10. Run tests and package macOS/Linux
11. Switch default startup target to `https://app.pirate/`

## Dependency Notes

- Proxy and cert work blocks meaningful browser testing
- Renderer normalization can be done before proxying, but not user-visible until proxy/cert are live
- Home/bootstrap work should come after registry events exist
- Packaging should come last, after local dev flow is stable

## Milestones

- **M1**: Helper runs, manager runs, browser sees HNS status
- **M2**: `https://app.pirate/` loads manually in dev (typed as full URL)
- **M3**: Typing `app.pirate/` works
- **M4**: Startup auto-redirect works
- **M5**: Packaged macOS/Linux builds work

## What Not To Do

- Don't special-case Pirate in routing
- Don't create a custom `hns://` browser protocol
- Don't install system-wide proxy settings from Freedom
- Don't install a system CA from Freedom for MVP
- Don't port Fingertip's tray/onboarding UI into the browser
- Don't make `homeUrl` dynamic
- Don't give the helper an HTTP control API
- Don't give the helper its own restart loop

## Acceptance Criteria

- Fresh install launches Freedom
- Home/bootstrap page shows sync state, then redirects to `https://app.pirate/`
- Typing `app.pirate/` in the address bar loads the site
- Bee/IPFS/Radicle still work and are not proxied into HNS
- Normal HTTPS browsing still uses default TLS verification
- `https://app.pirate/` works without any special-case browser code in `pirate-web`
