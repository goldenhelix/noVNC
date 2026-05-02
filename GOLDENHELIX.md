# Golden Helix Fork of `kasmtech/noVNC`

This fork carries a set of UI / integration patches on top of
`kasmtech/noVNC` master. Purpose: embed kasmweb inside **VSWarehouse**
as the noVNC client for our app-streaming images (`ghdesktop-*`):

```
VSWarehouse (parent page) ── iframe ──► kasmweb ── WebSocket ──► Xkasmvnc ── X11 ──► VarSeq / Office / etc.
                              ▲                                    │
                              └──── postMessage ───────────────────┘
```

Most of our patches exist because we want kasmweb to be a clean
embedded surface: no Kasm branding, no chrome we can't hide, a
postMessage control plane the parent can drive, and a couple of
Unix-relay file-transfer channels (openurl / download / upload).

## Branch and pinning

- Long-lived branch: **`goldenhelix-master-20260430`** in
  `goldenhelix/noVNC`.
- Forked from `kasmtech/noVNC` master at `e9054e7` (2026-03-24, master
  tip carrying the VNC-151 hardware-accel video work).
- Rollback tag: `pre-master-rebase-20260430`.

Don't track upstream `master` automatically — rebase to a chosen SHA,
smoke test, then move the branch.

## Patches in order (on top of `e9054e7`)

| # | Commit | Subject | Why |
|---|--------|---------|-----|
| 1 | `d7d2013` | Allow relative WebSocket URLs | VSWarehouse hosts kasmweb at non-root paths behind reverse proxies. We need `wss://host/<some/path>/websockify` to work without `host`/`port` settings. Switches `let url = "ws://" + host + ...` to `new URL(path, location.href)`. |
| 2 | `9bdaebb` | VarSeq branding + iframe support + hide game mode | Replaces all `kasm_logo*` / `368_kasm_logo_only_*` PNGs with `varseq.{svg,ico,png}` and `v_watermark.png`. Comments out `UI.addGamingHandlers()` (Kasm gamepad UI we don't want). Comments out the legacy `isInsideKasmVDI` detection in `index.html`/`screen.html`. |
| 3 | `345963a` | Hide drag control when remote resizing | `dragViewportHandler` becomes a no-op when `resize === 'remote'`. |
| 4 | `8de3221` | `window.addEventListener` postMessage UI toggles | The cross-frame control plane. VSWarehouse posts `{action,value}` messages to the iframe. Our cases: `show_panel`, `hide_panel`, `open_clipboard`, `close_clipboard`. (Plus existing upstream cases: `idle_session_timeout`, `enable_hidpi`, `control_displays`, `enable_threading`, `terminate`.) Adds `example_iframe.html` as the protocol demo. |
| 5 | `a8e0e3b` | Hide clipboard parent div | Companion to #4 — the side-panel clipboard wrapper hidden because the panel was relocated. |
| 6 | `0b48113` | Clipboard close button + suppress connect/disconnect toasts | `if (state == 'connected'/'disconnected') return;` so users don't see "Connected" / "Disconnected" notifications inside the embedded view. |
| 7 | `b747ed4` | Auto-reconnect + UI polish | Title `KasmVNC` → `Application Streaming`. `clearInterval(UI._sessionTimeoutInterval)` on disconnect. Comments out `_screen.style.overflow = orig` reset that flashed scrollbars on Chrome. Simplifies the keepalive loop to `UI.rfb.sendKeepAlive()` with no idle disconnect (VSWarehouse handles idle from the parent). |
| 8 | `becb6bd` | Fix "Raw channel missing property: send" | Current upstream `RFB` constructor at `core/rfb.js:91` does `typeof urlOrChannel === "string"` and treats anything else as a raw channel. Our patch #1 builds a `URL` object, so we have to call `.toString()` before passing. Without this the connection fails. |
| 9 | `1e5bbc6` | openurl UnixRelay handler | `core/output/openurl.js` plus 2 lines in `core/rfb.js`. Subscribes to the `openurl` UnixRelay; either `window.open()`s the URL (standalone) or `parent.postMessage({action:"openurl", value:url})` (iframe). End-to-end purpose: clicking a link inside the desktop opens it in the user's native browser. Server side wired by KasmVNC repo — see `unix/openurl/README.md`. |
| 10 | `7154920` | view_only: apply before other rfb settings | Move `UI.updateViewOnly()` so it runs immediately after RFB construction, before any resize-triggering setter. Lets `?view_only=true` take effect with no flicker. Setting flows through `initSetting → WebUtil.getConfigVar` (in-memory only, never persisted). |
| 11 | `c0f2ada` | display: clamp coordinates to framebuffer range | `absX`/`absY`/`clientToElement` could produce negative values when the cursor leaves the primary screen on a side with no adjacent virtual screen. Without clamping, the negative gets packed into a uint16 and the server saw a huge positive coord → cursor snaps to far edge. Fixes mouse-edge tracking on multi-monitor / non-aligned displays. |
| 12 | `2259138` | Add download / upload UnixRelay handlers | New `core/output/{download,upload,transfers}.js`. Download: subscribes to `download` relay, reassembles chunked blobs, triggers browser download via synthetic `<a download>` click. Upload: drag-drop overlay + per-file destination modal, chunks the file out over the `upload` relay. Shared progress UI in `transfers.js`. Server side wired by KasmVNC repo — see `unix/download/README.md` and `unix/upload/README.md`. |
| 13 | `9cf319d` | Hide the second-screen "Control Panel" sidebar | `screen.html` (the additional-display window) had an XFCE-style sidebar with a single Fullscreen button. VSWarehouse drives multi-display from the parent; we don't want any per-screen UI surfacing. Hidden via `display:none` on `#mySidenav` (kept in DOM since `ui_screen.js` event-listens on inner elements). |
| 14 | `2c61888` | Soften disconnect message | `"Something went wrong, connection is closed"` → `"The connection is closed"`. Container shutdown is the normal way for users to end a session; the previous wording was needlessly alarming. |
| 15 | `22f6789` | Drop printer + smartcard relay subscribers | We don't ship `kasm_printer_service` or `kasm_smartcard_bridge` daemons, so `SubscribeUnixRelay` for those names spammed "No such unix channel" on every connect. Comment out the two `initialize*` imports + calls in `rfb.js`; openurl + download + upload are kept. |
| 16 | `a2b9f2d` | upload: harden modal cleanup + default destination | `DEFAULT_DEST` changed from `~/Downloads` to `~/Workspace/Documents` to match where ghdesktop images keep user data. `showModal` cleanup is now idempotent (guarded by `removed` flag, sets `pointer-events:none` + `display:none` before detaching the backdrop) so a re-entrant click can't leave a residual overlay capturing pointer events. |
| 17 | `38d4a03` | Suppress codec notification overlay | Showing `"SW H.265"` / `"WEBP"` in a centered overlay every time stream mode picks/switches confused users. Comment out `showNotification(modeName)` in `applyStreamMode`; codec name is still tracked on `UI._lastStreamModeName` and exposed in the `noVNC_connection_stats` panel (visible when `set_perf_stats=true`). |
| 18 | `2ef6c02` | upload: subscribe to "upload" relay | Xvnc's `VNCSConnectionST::unixRelay()` (in `common/rfb/VNCSConnectionST.cxx`) gates outbound forwarding on subscription state — a client's RFB UnixRelay message is silently dropped if the client isn't subscribed to that relay name. Our `download.js` subscribes for legitimate reasons, but `upload.js` previously only sent. Adding `rfb.subscribeUnixRelay("upload", ()=>{})` registers send permission. Without this, drag-drop uploads "complete" on the JS side but no bytes ever reach the daemon. |

## Files we touch

If you're rebasing, expect conflicts in:

| Path | Notes |
|------|-------|
| `app/ui.js` | Biggest conflict surface — postMessage handlers, RFB constructor call site, view_only ordering, codec notification suppression. |
| `core/rfb.js` | Imports + initialize calls for openurl / download / upload (printer/smartcard commented out). |
| `core/output/{openurl,download,upload,transfers}.js` | All new files. |
| `core/display.js` | The clamp-to-fb-range patch. |
| `index.html` | Title, branding, removed apple-touch-icons + kasm logo + legacy `<script src="vendor/interact.min.js">`, commented-out `isInsideKasmVDI`. |
| `screen.html` | Same branding + `display:none` on `#mySidenav`. |
| `app/styles/base.css` | VarSeq color tweaks. |
| `app/webutil.js` | Iframe-parent communication hook. |
| `app/images/icons/varseq*.{png,svg,ico}`, `v_watermark.png` | Replace Kasm branding. |
| `app/images/icons/368_kasm_logo_only_*.png` | Deleted. |
| `example_iframe.html` | New file — minimal demo of the postMessage protocol. |

## Rebase procedure

1. Tag current tip: `git tag pre-master-rebase-YYYYMMDD goldenhelix-master-20260430`.
2. Pick a new `kasmtech/noVNC` SHA. Master is fine if you also rebase
   the `KasmVNC` server side in the same window.
3. `git checkout -b goldenhelix-master-YYYYMMDD <chosen-sha>`.
4. Cherry-pick the 18 patches above in order. Hot zones:
   - **`app/ui.js`** — most conflicts. Resolve by *preserving* upstream
     improvements and *layering* our cases on top.
   - For #8 (`url.toString()`) — re-verify after every rebase. If it
     regresses, the connection error becomes "Raw channel missing
     property: send".
   - For #18 (subscribe `"upload"`) — same; without it, uploads
     silently fail.
5. `npm install && npm run build`. Verify `dist/index.html`,
   `dist/vnc.html`, `dist/screen.html` are produced.
6. Bump kasmweb submodule pointer in the `KasmVNC` fork; rebuild deb;
   rebuild docker images; smoke test from a browser.

## What upstream now has that we used to need

- **Reconnect default `true`** — was patched, now upstream.
- **`sendKeepAlive`** — was hand-rolled in `bad1bdb`, now upstream.
- **Webpack → Vite** — happened upstream; don't add back webpack.

## Watch-outs

- If upstream rewrites the `RFB` constructor signature, patch #8
  needs re-thinking.
- The `"upload"` subscription requirement is a server-side gate — if
  Kasm ever changes that gating logic, patch #18 may become
  unnecessary or need to change.
