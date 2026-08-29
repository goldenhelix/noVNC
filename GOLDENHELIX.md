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
postMessage control plane the parent can drive, and the Unix-relay
file-transfer channels (openurl / download / upload / host).

## Branch and pinning

- Long-lived branch: **`goldenhelix-master-20260828`** in
  `goldenhelix/noVNC`.
- Forked from `kasmtech/noVNC` master at `1746dfe` (2026-08-28). This is
  the exact SHA that `kasmtech/KasmVNC` `7b5c304` pins its `kasmweb`
  submodule to — always rebase onto the SHA the server side pins, so
  client and server stay a matched pair.
- Rollback tag: `pre-master-rebase-20260828` (= previous tip `2443e80`
  on the retired `goldenhelix-master-20260430` branch).

Don't track upstream `master` automatically — rebase to a chosen SHA,
smoke test, then move the branch.

### Previous bases

| Branch | Upstream base |
|--------|---------------|
| `goldenhelix-master-20260828` | `1746dfe` (2026-08-28) |
| `goldenhelix-master-20260430` | `e9054e7` (2026-03-24) |

## Patches in order (on top of `1746dfe`)

| # | Commit | Subject | Why |
|---|--------|---------|-----|
| 1 | `e706d65` | Allow relative WebSocket URLs | VSWarehouse hosts kasmweb at non-root paths behind reverse proxies, so `wss://host/<some/path>/websockify` must work with no `host`/`port` settings. Upstream has since adopted `new URL(...)` itself; this patch is now a thin layer on top. |
| 2 | `1578eb5` | VarSeq branding + iframe support + hide game mode | Replaces Kasm logo assets with `varseq.{svg,ico,png}` / `v_watermark.png`; comments out `UI.addGamingHandlers()` and the legacy `isInsideKasmVDI` detection in `index.html` / `screen.html`. |
| 3 | `b18530a` | Hide drag control when remote resizing | `dragViewportHandler` becomes a no-op when `resize === 'remote'`. |
| 4 | `04ce0b5` | `window.addEventListener` postMessage UI toggles | The cross-frame control plane: `show_panel`, `hide_panel`, `open_clipboard`, `close_clipboard`. Adds `example_iframe.html`. |
| 5 | `20e6445` | Hide clipboard parent div | Companion to #4 — the clipboard block is relocated out of the side panel. |
| 6 | `0cd2847` | Clipboard close button + suppress connect/disconnect toasts | |
| 7 | `ae2e00f` | Auto-reconnect + UI polish | Title → `Application Streaming`; keeps scrollbars hidden in `core/rfb.js`; forces `reconnect` on and sets `reconnect_retries: 0`. See **Reconnect** below. |
| 8 | `301d973` | Fix "Raw channel missing property: send" | `RFB`'s constructor treats a non-string first arg as a raw channel, and patch #1 builds a `URL` object — so it must be `.toString()`d. **Re-verify after every rebase.** |
| 9 | `e03c4fd` | openurl UnixRelay handler | `core/output/openurl.js` + 2 lines in `core/rfb.js`. |
| 10 | `61148b5` | view_only: apply before other rfb settings | Lets `?view_only=true` take effect with no flicker. |
| 11 | `19cbb5c` | Add GOLDENHELIX.md | Documentation. |
| 12 | `7bda4e0` | display: clamp coordinates to framebuffer range | See **Coordinate clamp** below. |
| 13 | `0df27fd` | Add download / upload UnixRelay handlers | `core/output/{download,upload,transfers}.js` + `core/rfb.js`. |
| 14 | `5f71228` | Hide the second-screen "Control Panel" sidebar | `display:none` on `#mySidenav` in `screen.html` (kept in DOM; `ui_screen.js` listens on inner elements). |
| 15 | `7a193dc` | Soften disconnect message | `"Something went wrong…"` → `"The connection is closed"`. |
| 16 | `d29ced9` | Drop printer + smartcard relay subscribers | We don't ship those daemons; subscribing spammed "No such unix channel" on every connect. |
| 17 | `868f1d2` | upload: harden modal cleanup + default destination | `DEFAULT_DEST` = `~/Workspace/Documents`; idempotent modal teardown. |
| 18 | `a7e427f` | Suppress codec notification overlay | See **Codec notification** below. |
| 19 | `4ca194c` | upload: subscribe to the `"upload"` relay | Xvnc gates *outbound* relay forwarding on the client being subscribed to that relay name. Without this, drag-drop uploads "complete" but no bytes reach the daemon. **Looks like dead code. It is not. Do not delete it.** |
| 20 | `4faac81` | Refresh GOLDENHELIX.md | Documentation. |
| 21 | `24222b6` | Iframe embedding: downloads via parent + host channel | `core/output/host.js`; Firefox CSP `frame-src` blocks `blob:` URLs in a sandboxed iframe, so downloads route through `parent.postMessage`. |
| 22 | `94ed316` | Harden upload drag/drop and reconnect | New on the 20260828 rebase — see **Reconnect** below. |

Two commits from the previous branch were dropped as net-zero: a
`prefer_local_cursor` default flip and its revert.

## Files we touch

If you're rebasing, expect conflicts in:

| Path | Notes |
|------|-------|
| `app/ui.js` | Biggest conflict surface — postMessage handlers, RFB constructor call site, view_only ordering, reconnect settings, stats panel, codec suppression. |
| `app/control-panel-assets.js` | Our `varseqLogo` entry in upstream's bundled-asset map. |
| `core/rfb.js` | Imports + initialize calls for openurl / download / upload / host (printer/smartcard commented out). |
| `core/output/{openurl,download,upload,transfers,host}.js` | All new files. |
| `core/display.js` | The clamp-to-fb-range patch. |
| `index.html` | Title, branding, relocated clipboard block, hidden game mode, commented-out `isInsideKasmVDI`. |
| `screen.html` | Branding + `display:none` on `#mySidenav`. |
| `app/styles/base.css` | VarSeq color tweaks. |
| `app/webutil.js` | Iframe-parent communication hook, `isInsideKasmVDI()` forced to `false`. |
| `app/images/icons/varseq*.{png,svg,ico}`, `v_watermark.png` | Replace Kasm branding. |
| `example_iframe.html` | Minimal demo of the postMessage protocol. |

## `isInsideKasmVDI()` returns a hardcoded `false`

`app/webutil.js` short-circuits this function. That is deliberate — we
want the same behavior inside an iframe as outside — but upstream keeps
adding gates on it, and **every new `isInsideKasmVDI()` branch inverts
relative to Kasm's intent for us.** It now has ~20 call sites, several
of them added in the 1.5.x window. On every rebase, grep for new ones
and decide per-site. Known consequences today:

- **Reconnect** would be *off* (upstream defaults `reconnect` to
  `isInsideKasmVDI()`). We force it on — see below.
- **The codec notification overlay** would be *shown* (upstream's guard
  starts with `!isInsideKasmVDI()`). We suppress it — see below.
- **Stats** take the DOM path rather than being `postMessage`d to the
  parent. Upstream now forwards four stats channels (CPU/cgroup
  throttling, latency percentiles, fps) to the parent frame when inside
  VDI; we don't receive any of them. If VSWarehouse ever wants that
  telemetry, add explicit fork branches rather than flipping this
  function.

## Reconnect (patches #7 and #22)

Upstream `402c0c59` (VNC-377) re-architected disconnect/reconnect and
now builds a **fresh `RFB` for every reconnect**. Three consequences the
fork has to handle, all of them live because we force reconnect on:

1. `UI.initSetting('reconnect', true)` — upstream's default is
   `isInsideKasmVDI()`, which is `false` here.
2. `UI.initSetting('reconnect_retries', 0)` — `0` means unlimited (see
   `hasReconnectRetriesRemaining`). Upstream defaults to 5, which with
   our 2s delay abandons the session ~10s into an outage; and because
   `isInsideKasmVDI()` is false, `reconnectRetriesExceeded()` only logs
   and opens the control bar, so the parent frame is never told and the
   iframe is silently dead.
3. `core/output/upload.js` installs a body-level overlay and four
   `window` listeners. Those are **per page, not per RFB** — before #22
   each reconnect stacked another set, so one dropped file opened N
   modals and uploaded itself N times. `attachDragDrop` is now
   idempotent and retargets `currentRfb`. `transfers.js` already had
   this guard; any future body/window-level UI in a relay module needs
   the same treatment.

Do **not** re-inline the old hand-rolled keepalive loop. Upstream
extracted it into `startKasmSessionTimeoutInterval()` /
`stopKasmSessionTimeoutInterval()` with session-spanning idle tracking
(`activity` event, `lastActiveAt` / `preserveLastActiveAtOnConnect`
handed to the RFB constructor) and a null-sentinel guard. We take that
wholesale and neuter only the idle-disconnect branch inside it —
VSWarehouse owns idle policy. Note the guard: a bare
`clearInterval(UI._sessionTimeoutInterval)` that doesn't null the handle
makes `startKasmSessionTimeoutInterval()` early-return forever, killing
keep-alives after the first reconnect. That line was removed in the
rebase; don't reintroduce it.

## Codec notification (patch #18)

Upstream now wraps `showNotification(modeName)` in
`if (!WebUtil.isInsideKasmVDI() || …SHOW_NOTIFICATIONS…)`. That guard is
**true** for us, so the overlay would show. We keep the whole statement
commented out (upstream's version is retained inline as a comment for
the next rebase) and keep `UI._lastStreamModeName` for the stats panel.

The stats sink itself was rewritten upstream: `bottleneckStatsRecieve` →
`bottleneckStatsReceive`, `UI.updateFpsChart` → `UI.fpsChart.update`,
and — importantly — `innerHTML` → `textContent` (VNC-528, a security
fix). Our codec suffix is appended on the `textContent` path. **Do not
resolve this conflict by taking our old side**; it would reopen the sink
upstream just closed and call a deleted function.

## Coordinate clamp (patch #12)

Upstream's VNC-14 direct-drive mouse work added its own
`pointerEventClamped` path, which now duplicates the *negative* half of
our clamp. The *upper-bound* half (`>= _fbWidth → _fbWidth - 1`) is
still the only protection against a coordinate past the framebuffer
edge being packed into a uint16 and read by the server as a huge
positive. The patch is kept whole — the redundant negative legs are
harmless belt-and-braces.

## Rebase procedure

1. Tag current tip: `git tag pre-master-rebase-YYYYMMDD goldenhelix-master-<current>`.
2. Pick the SHA that the target `kasmtech/KasmVNC` revision pins for
   `kasmweb` (`git ls-tree <kasmvnc-sha> kasmweb`), not just master tip.
3. `git checkout -b goldenhelix-master-YYYYMMDD <chosen-sha>`.
4. Cherry-pick the patches above in order. Hot zones:
   - **`app/ui.js`** — most conflicts. Resolve by *preserving* upstream
     improvements and *layering* our cases on top, never by taking our
     whole side.
   - **`index.html`** — upstream (VNC-538) moved control-bar icons to a
     JS-injected asset map (`data-control-panel-src` +
     `app/control-panel-assets.js`). Keep that mechanism and register
     our asset in the map; do not go back to literal `src=` paths.
   - For #8 (`url.toString()`) — re-verify. If it regresses, the
     connection error is "Raw channel missing property: send".
   - For #19 (subscribe `"upload"`) — re-verify. Without it, uploads
     silently fail with no error on either side.
5. `npm install && npm run build`. Verify `dist/index.html`,
   `dist/vnc.html`, `dist/screen.html` are produced. (`npm run lint` is
   broken upstream — its eslint config predates eslint 9.)
6. Bump the `kasmweb` submodule pointer in the `KasmVNC` fork; rebuild
   the deb; rebuild the docker images; smoke test from a browser.

## What upstream now has that we used to need

- **Reconnect default `true`** — was patched, then upstream made it
  conditional on `isInsideKasmVDI()`; we're back to patching it.
- **`sendKeepAlive`** — now upstream.
- **Relative WebSocket URLs** — upstream now builds a `URL` too.
- **Keepalive/idle interval extraction** — now upstream
  (`startKasmSessionTimeoutInterval`), including the disconnect teardown
  we used to hand-roll.
- **Cursor-position clamping on the negative side** — now upstream.
- **Webpack → Vite** — happened upstream; don't add webpack back.

## Watch-outs

- If upstream rewrites the `RFB` constructor signature, patch #8 needs
  re-thinking.
- The `"upload"` subscription requirement is a server-side gate. It was
  verified still present in KasmVNC `7b5c304`.
- Any new body-level or `window`-level UI in a `core/output/*` module
  must be install-once, because the initializer now runs per reconnect.
