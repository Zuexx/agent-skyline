# Step 8: Its own window

Goal: the city runs in its own desktop window instead of a browser tab, so it can sit beside the
editor like a second monitor's dashboard:

- **Pin**: keep the window on top of other windows (toggle).
- **Opacity**: 30–100 %, from a slider in the window and a keyboard shortcut.
- **Resize** freely; position, size, pin and opacity are remembered per repo.
- **Click-through** (optional): while pinned and see-through, mouse clicks pass to the window
  below; a shortcut turns it off again. Lets the city float over the editor without getting in
  the way.

Status: draft, 2026-10-23. The browser keeps working as it does today; the window is another way
to open the same page.

## Shell

Electron (recommended): `BrowserWindow` has `alwaysOnTop`, `setOpacity()`, `setIgnoreMouseEvents()`
and resizing built in on Windows and macOS. It is installed with npm like the rest of the project,
with no other toolchain. It costs about as much memory as the browser tab it replaces.

Tauri was considered: smaller and lighter (it uses the WebView2 already on Windows 11), but it needs
a Rust toolchain to build and has no built-in window opacity. Revisit it if memory becomes the
limit.

## Pieces

- `desktop/`: an Electron app with its own `package.json` (kept out of the root package so the
  hooks and server stay dependency-free). It starts or finds the repo's server (`lib/autostart.mjs`)
  and loads its URL; it does not bundle its own copy of the web app.
- `skyline --window` opens the window instead of a browser tab; `skyline` keeps opening the
  browser unless `"window": true` is set in the user's settings.
- A slim title bar drawn by the page (pin, opacity slider, click-through, close), shown only when
  the page runs inside the window (`window.agentSkyline` from a preload script); the page talks to
  the window only through that preload API.
- Window state saved in `data/repos/<key>/window.json`.

## Budgets

Same as step 6 for rendering. When the window is hidden or minimized the page stops rendering
(`document.hidden`), so a pinned-but-minimized city costs next to nothing.
