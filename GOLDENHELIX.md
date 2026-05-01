# Golden Helix Fork of `kasmtech/noVNC`

This fork carries a small set of UI / integration patches on top of
`kasmtech/noVNC` master. The fork's purpose is to embed kasmweb inside
**VSWarehouse** as the noVNC client for our app-streaming images
(`ghdesktop-*`), with the rough flow:

```
VSWarehouse (parent page) ── iframe ──► kasmweb ── WebSocket ──► Xkasmvnc ── X11 ──► VarSeq / Office / etc.
                              ▲                                    │
                              └──── postMessage ───────────────────┘
```

Most of our patches exist because we want kasmweb to be a clean
embedded surface inside that iframe — no Kasm branding, no chrome we
can't hide, no UI affordances that confuse end users, and a couple of
cross-frame hooks so VSWarehouse can drive it.

## Branch and pinning

- Long-lived branch: **`goldenhelix-master-20260430`** in
  `goldenhelix/noVNC`.
- Forked from `kasmtech/noVNC` master at `e9054e7` (2026-03-24, latest
  master tip carrying the VNC-151 hardware-accel video work).
- Rollback tag on the previous fork tip: `pre-master-rebase-20260430`.

Don't track upstream `master` automatically; rebase to a chosen SHA, smoke
test, then move the branch.

## Patches in order (on top of `e9054e7`)

| # | Commit  | Subject | Why |
|---|---------|---------|-----|
| 1 | `d7d2013` | Allow relative WebSocket URLs | VSWarehouse hosts kasmweb at non-root paths and behind reverse proxies. We need `wss://host/<some/path>/websockify` to work without configuring `host`/`port` settings. Switches `let url = "ws://" + host + ...` to `new URL(path, location.href)`. |
| 2 | `9bdaebb` | VarSeq branding + iframe support + hide game mode | Replaces all `kasm_logo*` / `368_kasm_logo_*` PNGs with our `varseq.{svg,ico,png}` and `v_watermark.png`. Comments out `UI.addGamingHandlers()` (Kasm's gamepad UI we don't want). Comments out the legacy `isInsideKasmVDI` detection in `index.html` / `screen.html`. |
| 3 | `345963a` | Hide drag control when running remote resizing | The drag-viewport handle is meaningless when the server is doing the resize. Adds `if (UI.getSetting('resize') === 'remote') return;` in `dragViewportHandler` setup. |
| 4 | `8de3221` | `window.addEventListener` postMessage UI toggles | The cross-frame control plane. VSWarehouse posts `{action,value}` messages to the iframe. Cases handled: `enable_threading`, `show_panel`, `hide_panel`, `open_clipboard`, `close_clipboard`, plus the existing upstream ones (`idle_session_timeout`, `enable_hidpi`, `control_displays`, `terminate`). Also adds `example_iframe.html` as the documentation/demo of the protocol. |
| 5 | `a8e0e3b` | Hide clipboard parent div | Companion to commit 4: the clipboard panel was relocated outside the side panel, so the wrapper button/div in the side panel must be hidden. Comments out `UI.addClickHandle('noVNC_clipboard_button', ...)` and a few `showControlInput("noVNC_clipboard_button")` calls. |
| 6 | `0b48113` | Clipboard close button + suppress connect/disconnect toasts | `clipboard close` button in the panel, plus `if (state == 'connected'/'disconnected') return;` in the status update path so the user doesn't see "Connected" / "Disconnected" notifications inside the embedded view. |
| 7 | `b747ed4` | Auto-reconnect + UI polish | Title `KasmVNC` → `Application Streaming` in `index.html` / `screen.html`. `clearInterval(UI._sessionTimeoutInterval)` on disconnect. In `core/rfb.js`, comments out the `_screen.style.overflow = orig` reset that was making scrollbars flash on Chrome. (Note: upstream's reconnect default is now `true` with 2000 ms delay, which is what we want — no patch needed for that any more.) Also simplifies the keepalive loop to `UI.rfb.sendKeepAlive()` only, with no idle disconnect (VSWarehouse handles idle from the parent). |
| 8 | `becb6bd` | Fix "Raw channel missing property: send" | The current upstream `RFB` constructor at `core/rfb.js:91` does `typeof urlOrChannel === "string"` and treats anything else as a raw channel. Our patch 1 builds a `URL` object, so we have to call `.toString()` before passing. Without this the connection fails with `Error attaching channel (Error: Raw channel missing property: send)`. |
| 9 | `1e5bbc6` | openurl UnixRelay handler | `core/output/openurl.js` plus 2 lines in `core/rfb.js`. Subscribes to the `openurl` UnixRelay name (set up server-side by the KasmVNC fork — see its `unix/openurl/README.md`) and either `window.open()`s the URL (standalone) or `parent.postMessage({action:"openurl", value:url})` (iframe). End-to-end purpose: clicking a link inside the desktop opens it in the user's native browser, not in a chromium tab inside the X session. |
| 10 | `7154920` | view_only: apply before other rfb settings | Move `UI.updateViewOnly()` so it runs immediately after RFB construction, before any resize-triggering property setter. Lets `?view_only=true` take effect with no flicker. The setting itself flows through `initSetting → WebUtil.getConfigVar` (in-memory only, never persisted), so the same user gets r/w in a different tab without the param. |

## Files we touch

If you're rebasing, expect conflicts in roughly these files:

| Path | Why |
|------|-----|
| `app/ui.js` | Most of the patches modify this — especially the postMessage handlers, clipboard plumbing, RFB constructor call site, and view_only initialization. By far the biggest conflict surface. |
| `core/rfb.js` | Tiny — just the openurl import + initialize call (commit 9), and the `_screen.style.overflow` comment-out (commit 7). |
| `core/output/openurl.js` | New file. Greenfield. |
| `index.html` | Title, branding, removed apple-touch-icons / kasm logo imports, removed legacy `<script src="vendor/interact.min.js">` (interact is now an npm import), commented-out `isInsideKasmVDI`. |
| `screen.html` | Same branding/title changes as `index.html`, applied to the second-display window. |
| `app/styles/base.css` | Minor — VarSeq color tweaks. |
| `app/webutil.js` | One small hook for iframe parent communication. |
| `app/images/icons/varseq*.{png,svg,ico}`, `app/images/icons/v_watermark.png` | Replace Kasm branding. |
| `app/images/icons/368_kasm_logo_only_*.png` | Deleted. |
| `example_iframe.html` | New file — minimal demo of the postMessage protocol. |

## How to rebase to a newer upstream

1. In `goldenhelix/noVNC`, tag the current tip:
   `git tag pre-master-rebase-YYYYMMDD goldenhelix-master-20260430`
2. Pick a new `kasmtech/noVNC` SHA. Use master HEAD if you also want
   the latest feature branches Kasm has merged (hardware-accel video,
   etc.); use a `release/X.Y.Z` if you want stability.
3. `git checkout -b goldenhelix-master-YYYYMMDD <chosen-sha>`
4. Cherry-pick each of the 10 patches above in order. Hot zones:
   - `app/ui.js` will conflict around the RFB constructor call site
     and any `postMessage` switch statement upstream has touched.
     Resolve by *preserving* upstream's improvements and *layering*
     our cases on top.
   - For commit 8, make sure `url.toString()` survives whatever new
     conflict resolution you do — it's the load-bearing piece.
5. `npm install && npm run build`. Verify `dist/index.html`,
   `dist/vnc.html`, and `dist/screen.html` are produced and the
   bundle isn't huge larger than expected.
6. Smoke test: bump the kasmweb submodule pointer in the `KasmVNC`
   fork, rebuild the deb, rebuild the docker images, connect from a
   browser. Watch for the "Raw channel" error (regression of #8) and
   for view-only flicker (regression of #10).

## Things upstream now has that we used to patch

- **Reconnect default `true` with 2000ms delay** — already in
  upstream master, no patch needed.
- **Idle disconnect via `sendKeepAlive`** — upstream's implementation
  is good; our patch #7 just disables the idle path because
  VSWarehouse handles idle from the parent, but the keepalive itself
  is upstream's.
- **Webpack → Vite migration** — happened upstream. Our build now
  uses `npm run build` which invokes `vite build` under the hood.
  Don't try to add back webpack.

## Things upstream might break

If a future upstream rewrites the `RFB` constructor signature again,
the order of `(target, touchInput, urlOrChannel, options, videoCodecs,
isPrimaryDisplay)` may shift. Patch #8 only works because the third
argument is `urlOrChannel` and is type-checked as `string`. If that
changes, patches #1, #8 need re-thinking.
