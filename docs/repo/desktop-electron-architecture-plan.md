# Desktop Electron Architecture Plan

Status: proposed  
Audience: repo owners, desktop implementers, API owners, product review  
Scope: v1 structure and migration plan for replacing `pirate-tui` with a new `pirate-desktop` runtime repo

## Purpose

This document records the recommended architecture for a new Electron-based Pirate desktop app.

It is written as a cross-repo planning and audit artifact in `core`, not as an implementation doc inside a runtime repo, because:

- `core` owns the shared system definition
- runtime repos are sidecars in this workspace
- the decision spans `pirate-web`, `pirate-api`, the retired `pirate-tui` surface, and a new `pirate-desktop` repo

This plan is intentionally deeper than a scaffold note. It should be sufficient for design review, repo review, and early implementation sequencing.

## Executive Summary

The recommended direction is:

1. create a new sibling repo named `pirate-desktop`
2. use Electron, not Tauri
3. keep Electron `main` and `preload` isolated from `pirate-web`
4. reuse Pirate React UI from `pirate-web` aggressively
5. keep JackTrip and Sentinel behind process boundaries supervised by Electron `main`
6. start with Agora's browser SDK in the renderer on all platforms
7. treat Agora's Electron SDK as an optional later optimization for macOS and Windows only
8. move `pirate-tui` into maintenance mode once desktop covers the core host flows, with explicit retirement criteria

The important structural decision is that `pirate-desktop` is a new sidecar repo, not a subtree of `pirate-web`.

## Primary Decisions

### 1. Desktop belongs in its own repo

`pirate-desktop` should be a new sibling repo in the same local workspace pattern as:

- `pirate-api/`
- `pirate-web/`
- `pirate-contracts/`
- `pirate-tui/`

This matches the existing repo-boundary documents:

- [docs/repo/repo-boundaries.md](./repo-boundaries.md)
- [docs/repo/core-target-structure.md](./core-target-structure.md)
- [docs/repo/extraction-plan-tui.md](./extraction-plan-tui.md)

It also avoids mixing these incompatible runtime concerns in one repo:

- Cloudflare Worker and RedwoodSDK web runtime
- Electron `main` process and native process supervision
- preload IPC bridge code
- desktop packaging and OS integration

### 2. Electron is the correct shell for v1

Electron is the safer v1 because the main risk is runtime variance, not bundle size:

- Privy or browser-driven auth flows behave against one Chromium baseline
- embedded web content has one browser stack
- Agora WebRTC behavior stays closer to one runtime model across desktop platforms
- Electron `main` is well-suited to supervising local binaries and long-running desktop services

Tauri would add another systems layer on top of an already native-heavy stack:

- React renderer
- Rust host
- JackTrip native binaries
- Sentinel service binaries

That is additional complexity without a clear v1 payoff.

### 3. Process boundaries are preferred over native bindings

JackTrip and Sentinel should remain external processes managed by Electron `main`.

Do not build around:

- native Node addons
- direct embedding of JackTrip internals
- Sentinel bindings inside the renderer

The old JackTrip integration already proves the right pattern: it is lifecycle supervision around child processes, not a deep linked library model.

### 4. Agora should start in the renderer

The current recommendation is:

- use the browser-oriented Agora path in the Electron renderer first
- keep the interface behind a provider boundary so a native implementation can be swapped in later

Rationale:

- the legacy web code already has browser-oriented watch and broadcast controllers
- the local Agora Electron SDK checkout advertises macOS and Windows in the README, not Linux
- the package includes native-addon build machinery and platform-specific native downloads for macOS and Windows

Operational stance:

- Electron app on Linux: yes
- Agora Electron native wrapper on Linux: do not treat as a supported foundation
- Agora browser SDK inside Electron renderer on Linux: yes

### 5. Shared React code should be reused before extracted

Do not start with a large package extraction.

The first pass should share existing React code directly from `pirate-web` through a narrow and explicit surface. Extraction into a separate shared package can happen later if the direct-import surface proves stable.

This reduces time-to-first-shell and avoids a speculative monorepo refactor.

## Current Evidence Base

The recommendation above is grounded in the current codebase and adjacent references.

### Existing reusable web surface

The current `pirate-web` repo already contains a useful shared React layer:

- `pirate-web/src/app/router.ts`
- `pirate-web/src/components/compositions/app-shell-chrome/*`
- `pirate-web/src/components/compositions/feed/*`
- `pirate-web/src/components/compositions/onboarding-reddit-bootstrap/*`
- `pirate-web/src/components/compositions/post-card/*`
- `pirate-web/src/components/compositions/post-thread/*`
- `pirate-web/src/components/compositions/profile-page/*`
- `pirate-web/src/components/compositions/video-player/*`

These are valuable because they are mostly:

- React-only
- props-driven
- presentation-oriented
- not tightly coupled to Cloudflare Worker internals

Notably, `pirate-web/src/app/pages.tsx` is not the right thing to import directly into desktop because it is coupled to web mock data. Desktop should reuse the compositions and router contract, but own its own page/data layer.

### Existing native-process precedent

The legacy desktop code under `LEGACY-DO-NOT-USE/pirate-desktop` shows the correct process model:

- JackTrip is launched and supervised as child processes
- Linux audio-source configuration is OS-specific host logic
- browser auth is isolated from the local runtime

The important lesson is not to port the old UI technology, but to preserve the boundary choices.

### Existing livestream API direction

The API specs already describe the correct v2 stance:

- room creation is a control-plane operation done through web/app composer flows
- desktop/native host clients attach to an existing room
- host attach returns the broadcast credentials and handoff parameters

See:

- [specs/api/overview.md](../../specs/api/overview.md)
- [specs/api/src/components/schemas/livestreams.yaml](../../specs/api/src/components/schemas/livestreams.yaml)
- [specs/api/src/components/schemas/sentinel.yaml](../../specs/api/src/components/schemas/sentinel.yaml)

This matters because `pirate-desktop` should not reinvent canonical room creation. It should act as a host client and desktop runtime around the existing control-plane model.

## Repo Placement And Workspace Model

## Recommended workspace shape

```text
pirate-workspace/
  core/       # specs, docs, scripts
  api/        # backend/API repo
  contracts/  # contract repo
  web/        # web app repo
  desktop/    # desktop runtime repo
  android/    # Android runtime repo
```

## Ownership

- `core` keeps specs, docs, scripts, and system records
- `pirate-web` remains the canonical web app
- `pirate-desktop` becomes the canonical desktop runtime
- `pirate-tui` becomes a maintenance or retirement surface, not the future desktop UI path

## What should not happen

Do not:

- add tracked desktop runtime code to `core`
- place Electron `main` or `preload` inside `pirate-web`
- treat `pirate-web` as both the Cloudflare app and the desktop shell repo
- start by moving all shared UI into a new package before the Electron shell exists

## Proposed `pirate-desktop` Repo Shape

```text
pirate-desktop/
  electron/
    main.ts
    preload.ts
    windows/
      main-window.ts
      auth-window.ts
    ipc/
      auth.ts
      jacktrip.ts
      sentinel.ts
      system.ts
    protocols/
      pirate.ts
    auth/
      callback-server.ts
      auth-session-store.ts
    services/
      jacktrip-supervisor.ts
      sentinel-supervisor.ts
      service-events.ts
    state/
      desktop-session-store.ts

  src/
    entry.tsx
    app/
      desktop-app.tsx
      desktop-router.tsx
    adapters/
      auth-electron.ts
      jacktrip-electron.ts
      sentinel-electron.ts
      agora-browser.ts
      shell-electron.ts
    pages/
      page-renderer.tsx
      room-console.tsx
      settings-audio.tsx
      auth-status.tsx
    features/
      live/
        live-provider.ts
        room-console-state.ts
    types/
      desktop-bridge.ts
      electron-env.d.ts
    styles/
      desktop.css

  tests/
    electron/
    renderer/

  SHARED-SURFACE.md
  package.json
  tsconfig.json
  vite.config.ts
  README.md
```

## Responsibilities By Layer

### Electron `main`

Owns:

- app lifecycle
- `BrowserWindow` creation
- isolated auth window handling
- local callback server if auth flow uses localhost redirect
- JackTrip child process supervision
- Sentinel child process supervision
- OS integration
- secure IPC handlers

Does not own:

- feature UI
- feed rendering
- post/community/product composition logic
- direct React state beyond app bootstrap or service status fanout

### Electron `preload`

Owns:

- `contextBridge`
- a narrow typed desktop API
- event subscriptions from `main` to renderer

Does not own:

- business logic
- direct child-process management
- auth UI

### Renderer

Owns:

- product UI
- shared React compositions
- user-facing room console
- settings screens
- browser-oriented Agora integration
- application state derived from desktop bridge events and API responses

Does not own:

- child process spawning
- filesystem writes outside an explicit bridge
- unrestricted shell access

### Child processes

Own:

- JackTrip runtime
- `jackd` or equivalent local audio runtime when needed
- Sentinel background process

Do not own:

- Pirate UI
- canonical Pirate room state
- auth session UI

## Sharing Strategy

## Guiding rule

Share React feature code. Do not share platform runtime code.

This means:

- share compositions, route helpers, types, data adapters where browser-safe
- do not share Electron `main`
- do not share preload
- do not share child-process supervisors
- do not share Cloudflare Worker entrypoints or server-only code

## Phase 1 sharing mechanism: direct cross-repo imports behind alias discipline

The fastest low-regret option is:

1. create `pirate-desktop`
2. point TypeScript and Vite aliases at `../pirate-web/src`
3. document the approved shared import paths in `pirate-desktop/SHARED-SURFACE.md`
4. import only the approved shared surface

Recommended initial allowlist:

- `@pirate-web/components/compositions/**`
- `@pirate-web/components/primitives/**`
- `@pirate-web/app/router`
- `@pirate-web/lib/**` where browser-safe
- `@pirate-web/hooks/**` where browser-safe
- locale or copy helpers if they are renderer-safe

Recommended initial denylist:

- `@pirate-web/worker.tsx`
- RedwoodSDK and Cloudflare-specific files
- route document wrappers tied to server rendering
- anything that assumes Worker request context
- anything that relies on web-only auth globals without an adapter

Example alias shape:

```ts
// pirate-desktop/vite.config.ts
resolve: {
  alias: {
    "@pirate-web": resolve(__dirname, "../pirate-web/src"),
  },
}
```

This preserves tree-shaking better than a single barrel export file and keeps the dependency reviewable.

## Import hardening rule

Direct shared imports are allowed only until the first shared screen ships in desktop.

After that milestone:

1. all approved shared import paths must be documented in `pirate-desktop/SHARED-SURFACE.md`
2. any new shared import path must be reviewed explicitly
3. arbitrary `../pirate-web/src/**` sprawl is not allowed
4. desktop may not import `pirate-web` route pages that bundle mock data or web runtime assumptions

## Phase 2 sharing mechanism: extraction only if justified

Only after the shell is working and the shared surface is stable should we consider:

- `@pirate/ui`
- `@pirate/features`
- `@pirate/desktop-contracts`

Extraction is justified when:

- the desktop import surface is stable
- both repos need independent versioning or testability
- direct path imports are becoming fragile

Extraction is not justified merely because it looks cleaner on day one.

## Routing Strategy

`pirate-web/src/app/router.ts` is currently a good candidate for reuse because it is:

- client-side
- simple
- based on `window.history`
- not coupled to Cloudflare runtime assumptions

Desktop should start with a thin wrapper around that router rather than inventing a second routing model.

Recommended desktop routes:

- reuse existing product routes where possible:
  - `/`
  - `/your-communities`
  - `/c/:communityId`
  - `/p/:postId`
  - `/me`
  - `/onboarding`
  - `/auth`
- add desktop-only routes:
  - `/room-console/:roomId`
  - `/settings/audio`
  - `/settings/network`

The desktop-only routes should live beside the shared router integration, not inside `pirate-web`.

## Page and data layer

Desktop should not import `pirate-web/src/app/pages.tsx` directly.

Reason:

- it is coupled to mock data and web-route scaffolding assumptions
- it is a useful reference for composition wiring, but not the desktop page runtime

Desktop should provide its own page renderer that maps the shared `AppRoute` contract to shared compositions backed by live API data.

Recommended file:

```text
pirate-desktop/src/pages/page-renderer.tsx
```

Responsibilities:

- map `AppRoute` values to concrete page components
- fetch or subscribe to live API data
- adapt desktop session state into the shared composition props
- keep mock-data concerns out of the desktop renderer

Recommended v1 approach:

1. reuse `AppRoute` and route matching from `pirate-web`
2. create desktop page containers for home, onboarding, community, post, and profile
3. pass live API data into the shared compositions

## Adapter Model

The desktop app only needs a few adaptation boundaries.

### Auth adapter

Web:

- talks directly to Privy or existing web auth runtime

Desktop:

- asks Electron to open auth
- waits for completion over IPC
- stores or refreshes desktop session state through the desktop bridge

### Native-service adapters

Web:

- no JackTrip supervisor
- no Sentinel daemon

Desktop:

- calls `window.pirateDesktop.jacktrip.*`
- calls `window.pirateDesktop.sentinel.*`

### System adapter

Desktop-only actions such as:

- `openExternal`
- audio device inspection
- filesystem or log export

should sit behind a dedicated desktop adapter rather than leaking Electron APIs into shared components.

## IPC Surface

The preload bridge should be small, typed, and hostile to accidental expansion.

Recommended initial shape is phase-gated, not a full v1.0 bridge on day one.

### Phase 1 bridge

```ts
export interface PirateDesktopBridgeV1 {
  system: {
    openExternal(url: string): Promise<void>;
    getPlatform(): Promise<DesktopPlatformInfo>;
  };
}
```

### Phase 2 bridge additions

```ts
export interface PirateDesktopBridgeV2 extends PirateDesktopBridgeV1 {
  auth: {
    startLogin(): Promise<{ started: true }>;
    logout(): Promise<void>;
    getSession(): Promise<DesktopSession | null>;
    onSessionChanged(callback: (session: DesktopSession | null) => void): Unsubscribe;
  };
}
```

### Phase 3 bridge additions

```ts
export interface PirateDesktopBridgeV3 extends PirateDesktopBridgeV2 {
  jacktrip: {
    getStatus(): Promise<JackTripStatus>;
    connect(input: JackTripConnectInput): Promise<JackTripCommandResult>;
    disconnect(): Promise<JackTripCommandResult>;
    startLocalServer(input: JackTripServerInput): Promise<JackTripCommandResult>;
    stopLocalServer(): Promise<JackTripCommandResult>;
    onStatus(callback: (status: JackTripStatus) => void): Unsubscribe;
  };
}
```

### Phase 5 bridge additions

```ts
export interface PirateDesktopBridgeV5 extends PirateDesktopBridgeV3 {
  sentinel: {
    getStatus(): Promise<SentinelStatus>;
    ensureSubscription(input: SentinelEnsureInput): Promise<SentinelEnsureResult>;
    connect(input: SentinelConnectInput): Promise<SentinelCommandResult>;
    disconnect(): Promise<SentinelCommandResult>;
    onStatus(callback: (status: SentinelStatus) => void): Unsubscribe;
  };
}
```

Audio-device queries should ship only when the first desktop-only audio settings screen needs them. They are not part of the proof-of-shell bridge.

## IPC rules

1. renderer never receives unrestricted shell execution
2. renderer never receives raw `ipcRenderer`
3. all IPC payloads are validated at the `main` boundary
4. all event subscriptions are per-domain and typed
5. remote auth or embedded web content never receives the preload bridge

## Auth Architecture

## Recommended v1 model

Use system browser plus localhost callback for v1.

This is now the default decision, not an open preference.

Why:

- it gives the cleanest isolation boundary
- it matches the prior desktop pattern already proven in legacy Pirate
- it avoids granting remote auth content access to any Electron renderer privileges

The isolated auth `BrowserWindow` remains a fallback only if the system-browser flow is blocked by provider behavior or unacceptable UX constraints.

Two implementation options still exist, but Option B is the planned path:

### Option A: isolated auth `BrowserWindow`

Use a dedicated `BrowserWindow` with:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- limited navigation policy
- restricted permission handling

Pros:

- contained user experience
- easier desktop-only window orchestration

Cons:

- remote content inside Electron requires disciplined security controls

### Option B: system browser plus localhost callback

Reuse the old callback-server pattern:

1. `main` starts a localhost callback listener on a random port
2. desktop opens system browser to the auth endpoint
3. auth completes in the user's browser
4. callback returns to the desktop runtime

Pros:

- strongest isolation boundary
- avoids rendering untrusted remote auth content inside Electron

Cons:

- slightly less self-contained UX

## Planned stance

Phase 2 should implement Option B first.

Only switch to Option A if:

- the provider flow cannot complete reliably in the system browser, or
- there is a documented product reason the system-browser handoff is not acceptable

## Session handling

Desktop should own:

- persisted local session state
- token refresh coordination
- auth completion events

The auth completion step is not just a raw browser callback. It must also establish the desktop-scoped session exchange after the callback returns.

Legacy prior art:

- [`complete_browser_auth()` in legacy `auth.rs`](</home/t42/Documents/LEGACY-DO-NOT-USE/pirate-desktop/src/auth.rs:283>)

That prior flow:

1. waits for the browser callback
2. derives the persisted auth payload
3. exchanges and stores the desktop scrobble session
4. persists the resulting desktop session state locally

Desktop v1 should preserve that shape even if the naming changes away from "scrobble".

Desktop should not invent a new account model. It should integrate with the same backend session model already used by Pirate web.

## Desktop persistence policy

Desktop should persist only what is required for a stable local runtime.

Recommended persisted categories:

- desktop session and refresh metadata
- non-secret user settings
- audio preferences and selected devices
- recent room context
- lightweight diagnostics metadata

Recommended non-persisted or aggressively minimized categories:

- raw auth callback payloads after exchange completes
- unnecessary RTC tokens after expiry
- verbose transient process output unless needed for diagnostics

Recommended storage split:

- secrets and session credentials in OS-backed secure storage when available
- non-secret preferences in app config files under the standard Electron user-data path
- logs in a dedicated app log directory under user-data

Desktop persistence must document:

- exact file locations per OS
- which values are encrypted or delegated to OS credential storage
- retention limits for logs and diagnostics

## Live And Audio Architecture

## Room lifecycle source of truth

The control plane remains authoritative for:

- live room creation
- room metadata
- anchor post
- performer allocations
- listings and replay entitlements

Desktop is a host runtime, not the canonical room creator.

## Room and runtime state machines

The desktop UI and local services should be driven by explicit states, not ad hoc boolean flags.

### Room lifecycle state machine

Recommended desktop-facing room states:

```text
idle
  -> auth-required
  -> attached
  -> rtc-joining
  -> rtc-live
  -> degraded
  -> reconnecting
  -> stopped
  -> failed
```

Interpretation:

- `idle`: no active room context
- `auth-required`: desktop cannot proceed until session is valid
- `attached`: host or guest attach completed and credentials are available
- `rtc-joining`: renderer is joining Agora and local services may be preparing
- `rtc-live`: RTC is connected and the room is operational
- `degraded`: partial failure, such as RTC live without JackTrip or local audio routing warnings
- `reconnecting`: transient reconnect path after token renewal or network loss
- `stopped`: room ended locally or remotely in a clean way
- `failed`: unrecoverable failure requiring operator or user intervention

### JackTrip lifecycle state machine

```text
idle
  -> checking-deps
  -> starting-runtime
  -> connecting
  -> connected
  -> degraded
  -> reconnecting
  -> stopping
  -> failed
```

### Sentinel lifecycle state machine

```text
idle
  -> checking-entitlement
  -> starting-service
  -> connecting
  -> connected
  -> degraded
  -> reconnecting
  -> stopping
  -> failed
```

The UI should render from these states rather than reconstructing status from multiple independent booleans.

## Host flow

Recommended host flow:

1. room created through web/app composer against control plane
2. desktop opens or receives room context
3. desktop calls host attach
4. desktop receives broadcast credentials and room handoff state
5. renderer joins Agora as host using browser SDK
6. `main` coordinates JackTrip setup if room mode requires it
7. desktop reports state back to renderer

## Guest flow

Recommended guest flow:

1. invited guest opens desktop or web client
2. guest attach returns credentials
3. renderer joins Agora
4. local native audio setup occurs only where needed

## Agora provider strategy

Start with one implementation:

- `AgoraProviderBrowser`

It runs in the renderer and uses the browser SDK inside Electron Chromium.

Later, if necessary, add:

- `AgoraProviderElectronNative`

but only behind the same provider interface, and only when real capture or device issues justify it.

## Platform policy

### Linux

- supported by the Pirate desktop shell
- supported through browser-oriented Agora in the renderer
- not a target platform for the native Agora Electron wrapper in v1 planning

### macOS and Windows

- start with browser-oriented Agora in the renderer for consistency
- only add native Agora wrapper if real issues force it

This keeps the first platform matrix simpler:

- one renderer RTC implementation
- one desktop shell
- one native service-supervision model

## Agora browser-path go/no-go criteria

The browser-oriented Agora path remains the default on Linux, macOS, and Windows unless one of the following is demonstrated on a target platform:

- reliable failure to acquire required input or output devices in the renderer
- reliable failure to perform required host capture or publishing flows
- unacceptable stability issues that reproduce in Electron Chromium but not in the native wrapper
- documented product requirement that cannot be met by the browser SDK path

No native Agora escalation should happen without:

1. a written reproduction case
2. platform-specific evidence that the browser path is the blocker
3. confirmation that the native wrapper is actually supported on that target platform

## JackTrip Architecture

JackTrip is a desktop-native concern.

It should be controlled from `main`, not from the renderer.

## Responsibilities of `jacktrip-supervisor.ts`

- resolve binary path
- verify required dependencies
- start `jackd` if needed
- start `jacktrip`
- stop and clean up child processes
- expose structured status
- translate OS/process failures into renderer-safe status messages

## Service supervision semantics

All desktop-managed services should follow one supervision contract.

Required behaviors:

- startup timeout
- health-check or readiness signal
- structured crash classification
- bounded restart and backoff policy
- stale-process cleanup on app startup
- deterministic shutdown on app exit
- stable log locations

Recommended baseline policy:

- startup timeout: fail if readiness is not reached within a short fixed budget
- health check: use process liveness plus service-specific readiness when available
- restart policy: automatic retry only for transient startup and runtime failures
- backoff policy: exponential or stepped backoff with a hard retry ceiling
- stale cleanup: detect and terminate orphaned Pirate-managed child processes on launch
- crash classes:
  - configuration error
  - missing binary
  - permission error
  - dependency or device busy
  - runtime crash
  - user-initiated stop

Renderer-facing statuses should distinguish between:

- recoverable transient failure
- degraded but usable state
- fatal state that blocks room operation

## Renderer responsibilities

- show connection state
- render room-console actions
- display diagnostics
- request connect or disconnect through IPC

## OS-specific behavior

Keep Linux audio routing and setup logic out of shared React code.

That logic belongs in:

- `electron/services/jacktrip-supervisor.ts`
- any OS helper modules under `electron/services/jacktrip/`

Do not let Linux audio concerns contaminate shared components.

## Sentinel Architecture

Sentinel should follow the same pattern as JackTrip:

- separate managed process
- typed IPC boundary
- structured status events

## Responsibilities of `sentinel-supervisor.ts`

- ensure or validate subscription state
- start the local Sentinel service or wrapper process
- monitor readiness
- expose connection and error state
- stop process cleanly

Sentinel should use the same supervision contract as JackTrip rather than inventing a second service model.

## Relationship to control plane

Sentinel entitlement mapping should continue to flow through Pirate-side plan keys and API contracts rather than becoming desktop-local business logic.

Desktop should orchestrate the local dVPN runtime, not redefine entitlements.

## Desktop-Only Screens

Desktop should reuse shared product screens wherever possible and only add UI for truly desktop-specific concerns.

## Shared-first screens

- home feed
- your communities
- community view
- post thread
- profile
- onboarding

## Desktop-only screens

- room console
- audio settings
- network or dVPN settings
- desktop auth/session diagnostics

## UI policy

Desktop-only screens should still follow Pirate's design constraints:

- dark-first
- restrained orange accent
- no status pills unless truly necessary
- concise copy
- static titles where possible

## Packaging And Build Model

`pirate-desktop` should have its own:

- Vite config for the renderer
- build scripts
- release process

Do not couple desktop packaging to `pirate-web`'s Cloudflare build.

Packaging-tool choice is deferred until the repo reaches packaged-app needs. It is not part of the proof-of-shell scaffold.

Recommended script families:

- `dev:renderer`
- `dev:electron`
- `dev`
- `types`
- `test`

Later, once packaging starts, add the release-oriented script family appropriate to the chosen tool.

## Native binary packaging and version policy

JackTrip and Sentinel are not just runtime details. Their binary sourcing and lifecycle must be part of the contract.

The desktop repo should define:

- which binaries are bundled versus discovered on host PATH
- pinned version numbers per service
- expected OS and architecture matrix
- checksum or signature verification policy
- update policy
- fallback behavior when a required binary is unavailable

Recommended v1 policy:

- pin exact versions for bundled binaries
- record source URLs and checksums in the desktop repo
- select binaries by OS and architecture explicitly
- fail with structured diagnostics when the binary for the current platform is unavailable
- do not silently download arbitrary runtime binaries during normal app startup

Recommended binary metadata file:

```text
pirate-desktop/config/native-binaries.json
```

This file should record:

- service name
- version
- target OS
- target architecture
- source URL
- checksum
- bundled path or external resolution policy

## Security Requirements

The desktop app should follow Electron's stricter security posture from day one.

## Required defaults

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- strict navigation allowlists
- strict `window.open` handling
- no preload bridge in remote auth content
- no raw shell execution from renderer
- current Electron version policy

## Renderer trust model

There are two renderer categories:

### trusted local renderer

This is the main Pirate desktop UI. It may receive the limited preload bridge.

### remote or semi-remote auth content

This must not receive:

- Node integration
- shared preload APIs
- broad app privileges

## Test strategy

The desktop repo should define a testing contract from the start even if the first implementation is small.

### Shared React tests

- test shared desktop page containers and adapters in normal React test runners
- prefer prop-driven tests around imported compositions rather than duplicating composition internals

### Electron smoke tests

- one minimal app-launch smoke test
- one preload bridge smoke test for the currently active bridge phase
- one auth-flow smoke test once Phase 2 lands

### Service supervision tests

- startup success path
- missing-binary failure path
- child-process crash path
- stale-process cleanup path

### Release smoke tests

Once packaging exists, require packaged-app smoke coverage on release candidates for the supported target platforms.

The goal is not exhaustive desktop E2E coverage in Phase 0. The goal is to lock a minimal test contract early so packaging and service supervision do not remain untested until late.

## Migration Plan

## Phase 0: decision record and shell contract

Definition:

- this architecture doc is approved
- `pirate-desktop` repo is created
- ownership is explicit

Deliverables:

- repo created
- README with scope
- basic Electron window boot
- root `.gitignore` updated to ignore `pirate-desktop/`
- repo-boundary documents updated to list `pirate-desktop/` as a sidecar and `pirate-social-club/desktop` as a target runtime repo

## Phase 1: renderer boot and shared UI proof

Definition:

- Electron opens the main window
- desktop renderer can import a narrow shared surface from `pirate-web`
- one or two real screens render successfully

Recommended target screens:

- home feed
- onboarding

Exit criteria:

- no Worker runtime dependency leaks into renderer boot
- shared imports are narrow and documented
- desktop routes render through a desktop-owned page/data layer, not imported web mock pages

## Phase 2: auth integration

Definition:

- desktop login works through the chosen auth flow
- session state is persisted locally
- renderer can react to auth state changes

Exit criteria:

- no auth logic leaked into shared UI beyond adapters
- auth completion is observable through the desktop bridge

## Phase 3: JackTrip supervision

Definition:

- `main` can supervise JackTrip lifecycle
- renderer shows room-console status

Exit criteria:

- connect and disconnect work
- child-process cleanup is reliable
- renderer has no direct process access

## Phase 4: live room integration

Definition:

- desktop host attach consumes the control-plane room model
- renderer can host or join via Agora browser SDK

Exit criteria:

- host flow works from existing room state
- desktop does not create canonical rooms directly

## Phase 5: Sentinel integration

Definition:

- Sentinel enters only after host attach, Agora browser path, and JackTrip work end-to-end

Exit criteria:

- plan-key and entitlement flow remain API-driven
- desktop only owns local runtime orchestration

## Phase 6: extraction review

Definition:

- after real desktop usage, evaluate whether direct `pirate-web` imports should become extracted packages

Exit criteria:

- extraction is justified by actual friction, not aesthetic preference

## Audit Checklist

Use this list during implementation review.

### Repo boundary audit

- `pirate-desktop` exists as its own repo
- `core` does not track desktop runtime code
- `pirate-web` is not carrying Electron `main` or preload

### Sharing audit

- desktop imports only the approved shared surface from `pirate-web`
- Worker-only files are not imported into desktop renderer
- desktop-specific adapters are not pulled into `pirate-web`
- desktop page containers are desktop-owned and do not import `pirate-web/src/app/pages.tsx`
- post-proof-of-shell imports are documented in `pirate-desktop/SHARED-SURFACE.md`

### Security audit

- main window has secure defaults
- auth content is isolated
- preload bridge is narrow and typed
- renderer does not get arbitrary IPC or shell access

### Live/runtime audit

- room creation remains a control-plane concern
- desktop consumes host attach and start flows rather than replacing them
- JackTrip and Sentinel are supervised in `main`
- Agora starts with the browser-oriented renderer path
- service supervision behavior is defined for startup timeout, health, retry, and stale cleanup

### Linux audit

- Linux does not depend on the native Agora Electron wrapper
- Linux audio routing lives in host-side service code

### Product audit

- shared Pirate screens are actually reused
- desktop-only UI is limited to native concerns
- no redundant product fork of the feed, onboarding, or post UI appears inside `pirate-desktop`

### Persistence and test audit

- local persistence categories and storage locations are documented
- release-critical services have smoke coverage
- preload bridge tests exist for the currently shipped bridge phase

## Risks And Mitigations

## Risk: cross-repo imports become messy

Mitigation:

- use explicit alias-based import discipline
- document the approved import paths in `pirate-desktop/SHARED-SURFACE.md`
- keep the allowlist narrow
- defer extraction until usage stabilizes

## Risk: `pirate-web` shared code contains hidden web-runtime assumptions

Mitigation:

- start with the simplest compositions first
- avoid importing route document wrappers or Worker-bound files
- keep desktop adapters separate

## Risk: auth content inside Electron expands the attack surface

Mitigation:

- prefer system browser handoff when viable
- otherwise isolate auth in a dedicated locked-down window

## Risk: JackTrip and Linux audio behavior becomes a desktop-only support burden

Mitigation:

- keep all OS-specific setup code in host services
- report structured diagnostics to the renderer
- avoid blending OS logic into shared components

## Risk: early package extraction slows delivery

Mitigation:

- do not extract packages first
- prove the shell and shared surface before structural refactors

## TUI maintenance and retirement criteria

`pirate-tui` should not be treated as fully retired on day one of `pirate-desktop`.

Recommended policy:

- TUI enters maintenance mode once desktop covers auth, room attach, Agora host or guest RTC, and JackTrip orchestration
- new primary desktop GUI feature work should land in `pirate-desktop`, not `pirate-tui`
- full retirement requires confirming there are no remaining headless or terminal-first workflows that depend on TUI-only behavior

Until those criteria are met, the TUI remains a maintained fallback surface, not the primary future runtime.

## Open Decisions

These still require explicit product or engineering decisions.

### 1. Phase 1 sharing contract shape

Choose one:

- alias-based direct imports from a narrow allowlist
- extracted shared packages later, if justified

Recommendation:

- alias-based imports are acceptable only until the first shared desktop screen ships
- after that, all approved shared import paths must be documented in `pirate-desktop/SHARED-SURFACE.md`

### 2. Sentinel scope for v1

Choose one:

- include Sentinel in v1
- ship Electron auth + shared UI + JackTrip first, then add Sentinel

Recommendation:

- defer Sentinel unless it is strictly required for first-room success

### 3. Native Agora escalation criteria

Decide what specific failures would justify adding the native wrapper on macOS or Windows:

- screen capture failure?
- device routing failure?
- host broadcast instability?

Recommendation:

- define those criteria before adopting a second RTC provider

## Recommended Immediate Next Steps

1. approve this repo-placement and boundary model
2. create `pirate-desktop` as a sibling repo
3. bootstrap Electron main window and secure preload
4. add alias-based shared import discipline and `pirate-desktop/SHARED-SURFACE.md`
5. render one shared screen inside the Electron renderer
6. implement system browser plus localhost callback auth
7. wire JackTrip supervision before tackling deeper desktop-native UI

## Final Recommendation

The right v1 is not:

- a monorepo package extraction project
- a hybrid `pirate-web` plus Electron runtime repo
- a native-addon-heavy desktop rewrite

The right v1 is:

- `pirate-desktop` as a new sibling repo
- Electron shell
- secure auth boundary
- shared React UI from `pirate-web`
- JackTrip and Sentinel behind process supervision
- Agora browser SDK in the renderer first
- later extraction only if real reuse pressure justifies it
