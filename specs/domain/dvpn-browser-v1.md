# dVPN Browser Integration v1

Status: draft

Related docs:

- [dvpn.md](./dvpn.md) — Pirate dVPN domain spec (paid entitlement model)
- [../../docs/operators/sentinel-operator-runtime-contract.md](../../docs/operators/sentinel-operator-runtime-contract.md) — operator contract (WireGuard-only)
- [sentinel-ai-connect SDK](../../../blue-ai-connect/) — local SDK used as runtime engine

## Purpose

This doc defines the v1 browser integration for decentralized VPN access in Freedom.

It specifies:

- which integration model is used and why
- new main-process modules and their responsibilities
- PAC composition logic
- IPC contract
- settings UI fields
- state model and lifecycle
- budget safety
- first test plan

It does not replace [dvpn.md](./dvpn.md). That doc defines the Pirate-paid entitlement model. This doc defines a separate, earlier browser-first path. The two models converge later.

## Model Decision

v1 uses **self-funded local SDK** (Option A), not Pirate-paid entitlement (Option B).

Reasons:

1. The operator contract currently returns WireGuard payloads only (`transport_kind` must be `wireguard` per `sentinel-operator-runtime-contract.md:217`). WireGuard requires admin/root. Browser-first means no admin friction.
2. V2Ray runs in userland, creates a local SOCKS5 proxy, and needs no elevation. The SDK supports it directly with `protocol: 'v2ray'`.
3. The browser already has wallet primitives (address display, QR generation, balance queries, transaction signing) at `freedom-browser/src/main/preload.js:275` and `freedom-browser/src/renderer/lib/wallet/receive.js`. Self-funded is coherent with existing UX.
4. No backend dependency. No operator implementation needed. The SDK handles node discovery, payment, handshake, and tunnel locally.

Tradeoff accepted:

- user sees and funds their own Sentinel wallet
- balance management is a visible user concern
- not aligned with current Pirate entitlement model

Future path:

- when the operator contract supports V2Ray sessions, add Pirate-managed mode as a second integration path
- the browser can offer both models: "Fund your own" and "Pirate-managed"

## New Main-Process Modules

### `dvpn-manager.js`

Wraps `sentinel-ai-connect`. Owns wallet, session, and budget state.

Responsibilities:

- create Sentinel wallet (v1: `createWallet` only; `importWallet` deferred)
- store mnemonic encrypted via Electron `safeStorage` (separate from identity vault)
- call SDK `connect()` with fixed options
- call SDK `disconnect()`
- poll SDK `status()`
- subscribe SDK `onEvent()`
- check SDK `getBalance()`
- enforce budget caps by deriving session purchase size from budget
- auto-disconnect on cap breach, low balance, or max duration
- expose status to renderer via IPC
- call `disconnect()` on `before-quit`

SDK call constraints:

```
connect({
  mnemonic,
  protocol: 'v2ray',
  fullTunnel: false,
  systemProxy: false,
  gigabytes: <derived from dvpnMaxSpendP2P>,
})
```

`systemProxy: false` is mandatory. The SDK must never mutate OS proxy state. The browser owns proxy routing through its own PAC.

`fullTunnel: false` is mandatory. V2Ray split-tunnel means only traffic explicitly routed through the SOCKS5 proxy goes through the VPN. The browser routes traffic via PAC, not via system-level tunneling.

### Wallet Storage

The Sentinel wallet mnemonic is stored in a separate dVPN secret file encrypted with Electron's `safeStorage`, not in the identity vault. This keeps the Sentinel wallet independent from Pirate identity and avoids coupling vault unlock semantics to browsing.

Storage path: `app.getPath('userData')/dvpn/wallet.enc`

```js
const { safeStorage } = require('electron');
const encrypted = safeStorage.encryptString(mnemonic);
fs.writeFileSync(mnemonicPath, encrypted);
```

On read:

```js
const encrypted = fs.readFileSync(mnemonicPath);
const mnemonic = safeStorage.decryptString(encrypted);
```

Rules:

- never log the mnemonic
- never send the mnemonic to the renderer
- the renderer only sees the wallet address and balance
- if `safeStorage.isEncryptionAvailable()` returns false, disable wallet creation and show an explicit error in settings: "Private browsing unavailable — device encryption not supported." Do not fall back to plaintext storage.

### Session Purchase Policy

The SDK's `connect()` defaults to `gigabytes: 1` (README.md:157). To make `dvpnMaxSpendP2P` a real cap, the manager must derive the `gigabytes` parameter from the user's budget before calling `connect()`.

Rule:

1. before `connect()`, call SDK `estimateCost()` to get the per-GB price for the selected node
2. compute `rawGb = dvpnMaxSpendP2P / pricePerGB`
3. if `rawGb < 1`, refuse to connect — the budget is too small for even 1 GB at current node prices
4. otherwise, pass `gigabytes: Math.floor(rawGb)` explicitly in the `connect()` call

This makes the spend cap enforce the actual on-chain purchase size, not just an advisory pre-check.

### `network-manager.js`

Composes HNS + dVPN PAC. Sole owner of `session.setProxy()`.

Responsibilities:

- accept HNS proxy address from `hns-manager.js`
- accept dVPN SOCKS5 port from `dvpn-manager.js`
- generate PAC script based on current state
- start/stop PAC server
- call `session.defaultSession.setProxy()` when PAC changes
- provide `rebuild()` method that any consumer calls when their state changes

This module replaces the PAC ownership currently in `hns-manager.js`. HNS manager keeps its process management, cert verification, and IPC. It loses `buildPacScript()`, `startPacServer()`, `stopPacServer()`, `configureProxy()`, and `clearProxy()`.

## PAC Composition

### PAC rules

```
function FindProxyForURL(url, host) {
  // 1. Loopback always direct
  if (shExpMatch(host, "127.0.0.*") || host === "localhost" || host === "::1") {
    return "DIRECT";
  }

  // 2. HNS single-label hosts go to HNS proxy (when HNS is running)
  if (dnsDomainLevels(host) === 0) {
    return "PROXY <HNS_PROXY_ADDR>";
  }

  // 3. When dVPN is connected, everything else goes through V2Ray SOCKS5
  //    When dVPN is disconnected, everything else is DIRECT
  //    This line is swapped based on dVPN state:
  //    dVPN on:  return "SOCKS5 127.0.0.1:<V2RAY_PORT>; DIRECT";
  //    dVPN off: return "DIRECT";
}
```

### PAC regeneration triggers

The PAC must be regenerated when:

- dVPN connects (SOCKS5 port becomes known)
- dVPN disconnects (remove SOCKS5 from PAC)
- HNS proxy address changes
- HNS is disabled or stopped

### Dynamic port handling

V2Ray's SOCKS5 port is not known until `connect()` returns. The `connectResult.socksPort` is dynamic. Flow:

1. `dvpn-manager` calls `connect()`
2. `connect()` returns `{ socksPort: 11336, ... }`
3. `dvpn-manager` calls `networkManager.setDvpnProxy('127.0.0.1', 11336)`
4. `networkManager` regenerates PAC, restarts PAC server, calls `session.setProxy()`

### PAC server

Same pattern as current HNS PAC server. A local HTTP server on a random port serves the PAC script. Electron's `session.setProxy({ pacScript: url })` points at it.

## Changes to Existing Modules

### `hns-manager.js`

Remove:

- `buildPacScript()` (lines 119-129)
- `startPacServer()` (lines 131-155)
- `stopPacServer()` (lines 157-166)
- `configureProxy()` (lines 168-179)
- `clearProxy()` (lines 181-185)
- `pacServer`, `pacPort` module state (lines 116-117)

Add:

- call `networkManager.setHnsProxy(proxyAddr)` after `handleReady()` sets `proxyAddr`
- call `networkManager.clearHnsProxy()` in process exit cleanup and `stopHns()`
- call `networkManager.rebuild()` after any HNS proxy state change

The `handleReady()` function currently calls `configureProxy(defaultSession)` at line 254. This changes to `networkManager.setHnsProxy(proxyAddr)`.

The process `close` handler currently calls `clearProxy(session.defaultSession)` at line 386. This changes to `networkManager.clearHnsProxy()`.

### `service-registry.js`

Add `dvpn` entry to `registry`:

```js
dvpn: {
  api: null,
  proxy: null,           // e.g. '127.0.0.1:11336'
  mode: MODE.NONE,
  statusMessage: null,
  tempMessage: null,
  tempMessageTimeout: null,
  walletAddress: null,
  balance: null,
  funded: false,
  connected: false,
  sessionId: null,
  protocol: null,
  nodeAddress: null,
  country: null,
  ip: null,
  lastDisconnectReason: null,  // 'user', 'low_balance', 'budget_cap', 'max_duration', 'error'
},
```

### `settings-store.js`

Add to `DEFAULT_SETTINGS`:

```js
showDvpnControls: false,        // show dVPN section in settings
dvpnMaxSpendP2P: 1.0,         // max P2P to spend per session
dvpnLowBalanceStop: 0.5,      // auto-disconnect below this P2P
dvpnMaxDurationMinutes: 120,  // auto-disconnect after this many minutes
```

### `ipc-channels.js`

Add:

```js
// dVPN management
DVPN_START: 'dvpn:start',
DVPN_STOP: 'dvpn:stop',
DVPN_GET_STATUS: 'dvpn:getStatus',
DVPN_STATUS_UPDATE: 'dvpn:statusUpdate',
DVPN_GET_BALANCE: 'dvpn:getBalance',
DVPN_CREATE_WALLET: 'dvpn:createWallet',
DVPN_GET_WALLET_ADDRESS: 'dvpn:getWalletAddress',
```

Note: `DVPN_IMPORT_WALLET` is deferred from v1. Wallet import increases complexity (mnemonic input UI, validation) and the base flow should be stable first.

### `preload.js`

Add `dvpn` context bridge:

```js
contextBridge.exposeInMainWorld('dvpn', {
  start: () => ipcRenderer.invoke('dvpn:start'),
  stop: () => ipcRenderer.invoke('dvpn:stop'),
  getStatus: () => ipcRenderer.invoke('dvpn:getStatus'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('dvpn:statusUpdate', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('dvpn:statusUpdate');
  },
  getBalance: () => ipcRenderer.invoke('dvpn:getBalance'),
  createWallet: () => ipcRenderer.invoke('dvpn:createWallet'),
  getWalletAddress: () => ipcRenderer.invoke('dvpn:getWalletAddress'),
});
```

### `index.js` (bootstrap)

Add:

- `const { registerDvpnIpc, stopDvpn, initDvpn } = require('./dvpn-manager');` import
- `registerDvpnIpc();` in bootstrap
- `initDvpn()` in bootstrap if `settings.showDvpnControls` is true — loads wallet from disk, does NOT auto-connect
- `stopDvpn()` in `before-quit` alongside existing `stopHns()`

No auto-connect setting exists in v1. The user must explicitly click Connect each session. If auto-connect is added later, it must be a separate `connectDvpnOnLaunch` setting defaulting to `false`, because auto-connecting a paid metered service without explicit user consent is too aggressive.

## State Model

### dVPN states

```
off            — no wallet, no tunnel
wallet_ready   — wallet created/imported, funded or not
connecting     — SDK connect() in progress
connected      — tunnel active, traffic routing through SOCKS5
disconnecting  — SDK disconnect() called, tunnel tearing down
local_off_remote_pending  — local tunnel stopped, on-chain session end pending
error          — connection failed or unrecoverable state
```

### State transitions

```
off
  -> wallet_ready   (createWallet or importWallet succeeds)

wallet_ready
  -> connecting      (user toggles on, balance sufficient)
  -> off            (user clears wallet)

connecting
  -> connected      (connect() resolves with socksPort)
  -> wallet_ready   (connect() fails)
  -> error          (unrecoverable failure)

connected
  -> disconnecting   (user toggles off)
  -> local_off_remote_pending  (low balance, cap hit, max duration, app quit)
  -> wallet_ready   (disconnect completes)

disconnecting
  -> wallet_ready   (disconnect() resolves)

local_off_remote_pending
  -> wallet_ready   (on-chain session end confirmed)
  -> wallet_ready   (retry succeeds on next launch)

error
  -> wallet_ready   (user acknowledges, can retry)
```

### Offline disconnect

`disconnect()` is fire-and-forget on the on-chain session end. If the browser is offline when the user toggles off:

1. local V2Ray process is killed immediately
2. on-chain session end TX is broadcast as best-effort
3. if it fails, state goes to `local_off_remote_pending`
4. on next launch or connectivity restore, retry session end

The dVPN manager should persist `{ pendingSessionEnd: sessionId }` to disk. On next launch, if `pendingSessionEnd` exists, attempt the end-session call.

## Budget Safety

Budget caps are mandatory. Without them, a dVPN toggle is a "dangerous toggle" that can drain balance unattended.

### Settings

| Field | Default | Purpose |
|-------|---------|---------|
| `dvpnMaxSpendP2P` | 1.0 | Max P2P to spend per connect() call |
| `dvpnLowBalanceStop` | 0.5 | Auto-disconnect when balance drops below this |
| `dvpnMaxDurationMinutes` | 120 | Auto-disconnect after this duration |

### Enforcement

The dVPN manager enforces these in main process:

1. **Pre-connect check**: before calling `connect()`, call SDK `estimateCost()` to get per-GB price. Derive `gigabytes` from `dvpnMaxSpendP2P / pricePerGB` (minimum 1). If the computed value is 0 (price exceeds entire budget), refuse to connect. Pass `gigabytes` explicitly in the `connect()` call so the on-chain session purchase is bounded by the actual cap. See Session Purchase Policy.
2. **Balance polling**: while connected, poll `getBalance()` every 60 seconds. If balance drops below `dvpnLowBalanceStop`, auto-disconnect.
3. **Duration timer**: set a `setTimeout` for `dvpnMaxDurationMinutes` minutes after connect. On expiry, auto-disconnect.
4. **Budget notification**: on auto-disconnect, send IPC status update with `reason: 'budget_cap'`, `reason: 'low_balance'`, or `reason: 'max_duration'` so the renderer can display it. Persist `lastDisconnectReason` in the service registry.

## Settings UI

New section in the settings modal, parallel to HNS.

### HTML structure

After the Handshake section (`#hns-section`) at `index.html:1771`, before the Experimental section (`#experimental-section`) at `index.html:1812`:

```html
<!-- dVPN Section -->
<section class="settings-section" id="dvpn-section">
  <h3 class="settings-section-header">Private Browsing</h3>

  <!-- Toggle: controls visibility of the entire section -->
  <div class="settings-toggle-row">
    <span class="toggle-label">Show private browsing controls</span>
    <label class="toggle-switch">
      <input type="checkbox" id="show-dvpn-controls" />
      <span class="toggle-slider"></span>
    </label>
  </div>

  <!-- Wallet creation: explicit action, not side-effect of toggle -->
  <div class="dvpn-wallet-setup" id="dvpn-wallet-setup">
    <button type="button" class="dvpn-control-btn" id="dvpn-create-wallet-btn">Create Wallet</button>
  </div>

  <!-- Wallet address + QR (visible after wallet created) -->
  <div class="dvpn-wallet-row" id="dvpn-wallet-row" style="display: none;">
    <span class="dvpn-label">Wallet</span>
    <span class="dvpn-value" id="dvpn-wallet-address"></span>
    <button type="button" class="icon-btn" id="dvpn-copy-address" aria-label="Copy address">
      <!-- copy icon -->
    </button>
  </div>
  <div class="dvpn-qr-row" id="dvpn-qr-row" style="display: none;">
    <img id="dvpn-qr-image" alt="dVPN wallet QR code" />
  </div>

  <!-- Balance -->
  <div class="dvpn-status-row" id="dvpn-balance-row" style="display: none;">
    <span class="dvpn-label">Balance</span>
    <span class="dvpn-value" id="dvpn-balance-value">—</span>
    <button type="button" class="icon-btn" id="dvpn-refresh-balance" aria-label="Refresh balance">
      <!-- refresh icon -->
    </button>
  </div>

  <!-- Connection status (visible when connected) -->
  <div class="dvpn-status-display" id="dvpn-status-display" style="display: none;">
    <div class="dvpn-status-row">
      <span class="dvpn-label">Status</span>
      <span class="dvpn-value" id="dvpn-status-value">Off</span>
    </div>
    <div class="dvpn-status-row" id="dvpn-node-row" style="display: none;">
      <span class="dvpn-label">Node</span>
      <span class="dvpn-value" id="dvpn-node-value"></span>
    </div>
    <div class="dvpn-status-row" id="dvpn-country-row" style="display: none;">
      <span class="dvpn-label">Country</span>
      <span class="dvpn-value" id="dvpn-country-value"></span>
    </div>
    <div class="dvpn-status-row" id="dvpn-ip-row" style="display: none;">
      <span class="dvpn-label">IP</span>
      <span class="dvpn-value" id="dvpn-ip-value"></span>
    </div>
    <div class="dvpn-status-row" id="dvpn-error-row" style="display: none;">
      <span class="dvpn-label">Error</span>
      <span class="dvpn-value dvpn-error-text" id="dvpn-error-value"></span>
    </div>
  </div>

  <!-- Budget settings (visible when wallet exists) -->
  <div class="dvpn-budget-settings" id="dvpn-budget-settings" style="display: none;">
    <div class="settings-toggle-row sub-toggle">
      <span class="toggle-label">Max spend per session (P2P)</span>
      <input type="number" id="dvpn-max-spend" class="settings-input" step="0.1" min="0.1" />
    </div>
    <div class="settings-toggle-row sub-toggle">
      <span class="toggle-label">Low balance stop (P2P)</span>
      <input type="number" id="dvpn-low-balance-stop" class="settings-input" step="0.1" min="0.1" />
    </div>
    <div class="settings-toggle-row sub-toggle">
      <span class="toggle-label">Auto disconnect after (minutes)</span>
      <input type="number" id="dvpn-max-duration" class="settings-input" step="30" min="30" />
    </div>
  </div>

  <!-- Connect / Disconnect -->
  <div class="dvpn-controls" id="dvpn-controls" style="display: none;">
    <button type="button" class="dvpn-control-btn" id="dvpn-connect-btn" disabled>Connect</button>
    <button type="button" class="dvpn-control-btn" id="dvpn-disconnect-btn" disabled>Disconnect</button>
  </div>
</section>
```

### UI states

**Wallet not created:**
- Toggle: enabled, unchecked
- "Create Wallet" button: visible
- Wallet address: hidden
- Connect button: hidden

**Wallet created, not funded:**
- Toggle: enabled, checked
- "Create Wallet" button: hidden
- Wallet address: visible, `sent1...`
- QR code: visible
- Balance: "0.00 P2P"
- Connect button: disabled (insufficient balance)
- Budget settings: visible

**Wallet funded, not connected:**
- Toggle: enabled, checked
- Balance: "1.50 P2P"
- Connect button: enabled
- Disconnect button: disabled

**Connected:**
- Toggle: enabled, checked
- Status display: visible
- Status: "Connected"
- Node: `sentnode1...` or moniker
- Country: "Germany"
- IP: `185.xxx.xxx.xxx`
- Connect button: disabled
- Disconnect button: enabled

**Auto-disconnected (budget reason):**
- Status: "Stopped - low balance" / "Stopped - budget cap" / "Stopped - max duration"
- `lastDisconnectReason` persisted in registry and visible in status display
- Connect button: disabled (if balance too low) or enabled (if duration cap hit)

### `settings-ui.js` additions

New DOM element bindings and handlers mirroring the HNS pattern:

```js
let showDvpnControlsCheckbox = null;
let dvpnCreateWalletBtn = null;
let dvpnWalletAddress = null;
let dvpnCopyAddressBtn = null;
let dvpnQrImage = null;
let dvpnBalanceValue = null;
let dvpnRefreshBalanceBtn = null;
let dvpnStatusValue = null;
let dvpnNodeRow = null;
let dvpnNodeValue = null;
let dvpnCountryRow = null;
let dvpnCountryValue = null;
let dvpnIpRow = null;
let dvpnIpValue = null;
let dvpnErrorRow = null;
let dvpnErrorValue = null;
let dvpnConnectBtn = null;
let dvpnDisconnectBtn = null;
let dvpnMaxSpendInput = null;
let dvpnLowBalanceStopInput = null;
let dvpnMaxDurationInput = null;
let dvpnBudgetSettings = null;
let dvpnStatusDisplay = null;
```

New functions:

- `updateDvpnSettingsVisibility()` - show/hide sub-sections based on toggle
- `updateDvpnStatusDisplay(status)` - update status rows based on IPC status
- `updateDvpnBalance(balance)` - update balance display

Integrate with `saveSettings()` to persist `showDvpnControls`, `dvpnMaxSpendP2P`, `dvpnLowBalanceStop`, `dvpnMaxDurationMinutes`.

## SDK Binary Packaging

`sentinel-ai-connect` downloads V2Ray 5.2.1 during `npm install` via `setup.js`. For the browser:

- **packaged mode**: V2Ray binary is bundled in `process.resourcesPath/dvpn-bin/` alongside the existing HNS binaries. The `dvpn-manager` detects `app.isPackaged` and sets `v2rayExePath` accordingly. This is mandatory for v1 — no download-on-first-use path.
- **dev mode**: the SDK's local `bin/v2ray` path is used if present. If missing, `connect()` fails with `V2RAY_NOT_FOUND` and the user sees a clear "V2Ray binary not found" message directing them to run the SDK setup. No silent fallback.

V2Ray binary size: ~15 MB across platforms. This is acceptable for the existing packaging flow.

## DNS Integration

HNS and dVPN are independent DNS/routing layers:

- HNS resolves single-label hostnames via its own proxy
- dVPN encrypts traffic to standard domains via SOCKS5

The PAC handles the composition. No SDK `dns:` option should be used as the primary integration. Specifically:

- do not pass `dns: 'handshake'` to the SDK. The browser has its own HNS resolver.
- the V2Ray process does not need to know about HNS.
- HNS queries go to the HNS proxy (which uses direct internet). HNS outbound traffic does not need to ride the dVPN tunnel.

If a user wants HNS + dVPN privacy for HNS resolution specifically, that is a future enhancement requiring the HNS proxy's outbound traffic to be routed through the SOCKS5 tunnel. This is out of scope for v1.

## Session Lifecycle

### Normal flow

1. user enables "Show private browsing controls" toggle in settings
2. user clicks "Create Wallet" button explicitly
3. `dvpn-manager` creates wallet via SDK `createWallet()`, stores encrypted mnemonic
4. renderer shows wallet address + QR
5. user funds wallet externally (swap.sentinel.co, Osmosis, etc.)
6. `dvpn-manager` polls `getBalance()` every 30s while wallet is not funded
7. once funded, Connect button enables
8. user clicks Connect
9. `dvpn-manager` derives `gigabytes` from `dvpnMaxSpendP2P` and current node price (see Session Purchase Policy)
10. `dvpn-manager` calls `connect({ mnemonic, protocol: 'v2ray', fullTunnel: false, systemProxy: false, gigabytes })`
11. on success, `dvpn-manager` calls `networkManager.setDvpnProxy('127.0.0.1', result.socksPort)`
12. PAC regenerates, browser traffic now routes through V2Ray
13. status updates to `connected`

### Disconnect flow

1. user clicks Disconnect or toggle off
2. `dvpn-manager` calls `disconnect()`
3. `dvpn-manager` calls `networkManager.clearDvpnProxy()`
4. PAC regenerates, browser traffic reverts to direct
5. status updates to `wallet_ready`

### App quit

1. `before-quit` handler calls `stopDvpn()`
2. `stopDvpn()` calls `disconnect()` with a short timeout
3. if disconnect succeeds, clear PAC dVPN entry and exit
4. if disconnect times out, kill V2Ray process, persist `pendingSessionEnd` to disk, clear PAC, exit

### Crash recovery

1. on next launch, `dvpn-manager` checks for `pendingSessionEnd` in persistent state
2. if found, attempt to end the on-chain session
3. clear the persisted state regardless of success (fire-and-forget)
4. check `status()` - if SDK thinks a tunnel is active but browser state says off, force cleanup

## Error Handling

### SDK errors the dVPN manager must handle

| SDK error | Manager action | Renderer feedback |
|-----------|----------------|-------------------|
| `INSUFFICIENT_BALANCE` | do not attempt connect | "Insufficient balance. Fund your wallet." |
| `INVALID_MNEMONIC` | clear stored wallet, show create-wallet button | "Wallet key invalid. Create a new wallet." |
| `ALL_NODES_FAILED` | retry up to 2 times with backoff | "No nodes available. Retrying..." |
| `V2RAY_NOT_FOUND` | do not attempt connect | "V2Ray not installed. Reinstall Freedom." |
| `NODE_OFFLINE` | retry with next node | - (handled by SDK maxAttempts) |
| `PARTIAL_CONNECTION_FAILED` | note session exists on-chain, do not retry connect | "Session already active. Disconnect first." |
| `SESSION_EXISTS` | call `disconnect()` first, then retry | "Ending previous session..." |

### Unrecoverable errors

If `connect()` fails 3 times with different nodes, set state to `error`. Show error message in status display. User must acknowledge before retrying.

## Implementation Order

1. **`network-manager.js`** - extract PAC from `hns-manager.js`, add dVPN proxy state, add `rebuild()`
2. **`hns-manager.js` refactor** - remove PAC ownership, call `networkManager` instead
3. **`dvpn-manager.js`** - wallet, connect, disconnect, status, budget enforcement
4. **`service-registry.js`** - add `dvpn` entry
5. **`settings-store.js`** - add dVPN defaults
6. **`ipc-channels.js`** - add dVPN channels
7. **`preload.js`** - add `window.dvpn` bridge
8. **`index.html`** - add dVPN settings section
9. **`settings-ui.js`** - add dVPN bindings and handlers
10. **`index.js`** - register dVPN IPC, add to bootstrap and quit

## Test Plan

### Unit tests

**`network-manager.js`**
- PAC generation with HNS only (matches current behavior)
- PAC generation with HNS + dVPN
- PAC generation with dVPN only (no HNS)
- PAC generation with neither (all DIRECT)
- PAC regenerates when `setDvpnProxy()` called
- PAC regenerates when `clearDvpnProxy()` called
- PAC regenerates when `setHnsProxy()` called
- PAC regenerates when `clearHnsProxy()` called

**`dvpn-manager.js`**
- `createWallet()` returns `{ address, mnemonic }`
- `getBalance()` returns formatted balance
- `startDvpn()` refuses when balance insufficient
- `startDvpn()` refuses when already connected
- `stopDvpn()` calls SDK `disconnect()`
- budget cap enforcement: auto-disconnect when balance below threshold
- duration cap enforcement: auto-disconnect after max minutes
- pre-connect cost estimate exceeds max spend: refused

### Integration tests

- HNS works independently of dVPN (regression from PAC refactor)
- dVPN connect + HNS enabled: both HNS names and dVPN traffic work
- dVPN connect without HNS: traffic routes through SOCKS5
- dVPN disconnect: traffic reverts to direct
- **tab traffic routes through composed proxy**: open a webview tab (tabs.js:203) while dVPN is connected, verify the tab's HTTP requests go through the SOCKS5 proxy (check via ipify or similar)
- app quit with dVPN connected: clean disconnect
- app crash recovery: orphaned session reconciled on next launch

### Manual test sequence

1. Fresh install, no wallet: settings shows "Create Wallet" button
2. Click Create Wallet: address + QR displayed
3. Fund wallet externally
4. Balance updates within 60s
5. Click Connect: status changes to Connected, node/country/IP displayed
6. Visit https://api.ipify.org: shows VPN IP
7. Visit HNS site: still resolves (HNS + dVPN both working)
8. Click Disconnect: status reverts, ipify shows real IP
9. Set max duration to 1 minute, connect: auto-disconnects after 1 minute
10. Set low balance stop to 0.9 P2P, fund with 1.0 P2P, connect: auto-disconnects when balance drops
11. Quit browser while connected: restart shows clean state, no orphaned tunnel

## Resolved Decisions

- **Wallet mnemonic storage**: use Electron's `safeStorage` API with a separate dVPN secret file at `app.getPath('userData')/dvpn/wallet.enc`. Not the identity vault. Keeps the Sentinel wallet independent from Pirate identity.
- **V2Ray binary distribution**: bundle V2Ray in app resources for packaged builds. No download-on-first-use path for v1.
- **P2P token acquisition**: external funding only for v1. Show address, QR, refresh balance, and a link to swap.sentinel.co. Do not implement in-browser swap or IBC.
- **Wallet import**: deferred from v1. Support `createWallet()` only. `importWallet()` adds mnemonic input UI complexity; ship the base flow first.

## Out of Scope for v1

- WireGuard protocol support (requires admin)
- Pirate-paid entitlement / operator-backed mode
- HNS outbound traffic through dVPN tunnel
- Automatic P2P token swap from other assets
- Wallet import (createWallet only in v1)
- Country/region selection in settings
- Node selection in settings
- Kill switch
- Auto-connect on launch (explicit Connect action required)
- System-wide traffic routing (default Electron browser session only, which covers all tab/webview traffic)
- Mobile-specific adaptations
