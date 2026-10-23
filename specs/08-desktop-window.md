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

## Shell: decided by measurement, not up front

Two candidates, neither chosen yet. Both get a minimal prototype (8A) that loads the running city
and implements pin, opacity, resize and click-through; the choice follows the numbers.

| Candidate | Expected (unverified until 8A) |
|---|---|
| Electron | Bundles Chromium; installs with npm, no other toolchain; window APIs for always-on-top, opacity and click-through are documented |
| Tauri | Uses the system WebView2 (Windows) / WKWebView (macOS); smaller install, likely less memory; needs a Rust toolchain to build; opacity and click-through support to be checked |

### 8A: prototype both, measure, then choose

Measured on this machine (Windows 11, RTX 4090) with the same repo, the city open at overview zoom:

| Measure | How |
|---|---|
| Install size and build time | Size of the built app; time for a clean build |
| Memory | Working set of all the app's processes after 2 minutes idle and after 2 minutes of live events |
| CPU / GPU | Average while idle and while events stream (`bench/` event replay) |
| Frame rate | The city's own fps counter at 20,000 files (`bench/perf.mjs` repo) |
| Startup | Launch to first rendered frame |
| Pin | Stays above other windows, including a full-screen editor |
| Opacity | Works on Windows and macOS, adjustable live, and what the 3D canvas looks like see-through |
| Click-through | Clicks reach the window below; a shortcut turns it back off |
| Resize | Smooth, canvas re-fits, no flicker |
| Toolchain cost | What a new machine must install to build it |

Each row records the real result, or "not tested" with the reason. The results go into this file,
followed by the choice and why. Whichever is not chosen keeps its prototype on a branch.

### 8A, first round: the painted town (2026-10-23)

The town direction (`09-visual-language.zh-TW.md`, `10-town-pack.md`) added a third candidate:
**Godot**, which is renderer and window in one. Prototype in `proto/town-render/`. All of them read the
same town pack (v4 town, 13 MB) and the same live state (`state.mjs`, which follows the server's
event stream), and draw the same things. Benchmark: `bench.mjs`, same agents (`--demo-fixed`),
10 s per scene; raw rows in `bench-results-all.jsonl` (its Tauri memory figures are double-counted,
see below).

| Measure | Web page (Chrome) | Electron 45 | Tauri 2 (WebView2) | Godot 4.7.2 |
|---|---|---|---|---|
| Looks | Same as the art proof of concept; characters slightly darker | same as web | same as web | Same as the proof of concept |
| At the display rate (240 Hz), all four scenes incl. 3840×1920 | 240 fps, 0 frames over 20 ms | 240, 0 over 20 ms (one run: 2) | 240, 0 over 20 ms | 240, 0 over 20 ms |
| Same, window 85 % see-through | — | 240, 0 over 20 ms (`setOpacity`) | 240, 0 over 20 ms (transparent window, page fades itself) | 240, 0 over 20 ms (per-pixel transparency) |
| Uncapped worst frames | 50–90 ms stalls several times a second: the frame queue throttling without vsync; gone at the display rate | same | same | none (p99 1.4 ms) |
| GPU time per frame (at the display rate), 1080p | 1.3–4.5 ms | 3.7–4.0 ms | 0.9–3.7 ms | 1.1–1.5 ms |
| GPU time per frame, 3840×1920 | 4.7 ms | 4.0 ms | 2.8 ms | 2.3 ms |
| RAM, all processes, at the display rate | 0.95–1.0 GB | 0.87–0.95 GB | ~0.9 GB (checked live: 914 MB, 11 processes) | 1.57–1.64 GB (to investigate: likely the 2 M-vertex grid kept on the CPU) |
| GPU memory (dedicated) | 510–540 MB | 520–550 MB | ~550 MB | 840–870 MB |
| Load (pack to first frame, inside the app) | 0.2–0.3 s | 0.2–0.3 s | 0.2–0.3 s | 0.37 s |
| Pin on top | not possible in a tab | set; the user had it open pinned (not explicitly confirmed) | same | same, flag read back |
| See-through | not possible in a tab | set; the user had it open at 85 % (not explicitly confirmed) | same | same, flag read back |
| Frameless, resize | — | yes / yes | yes / yes | yes / yes |
| Click-through | — | not tested yet | not tested yet | not tested yet |
| Size on disk | — | 357 MB unpacked runtime | **8 MB** app (uses the system WebView2) | 173 MB editor; an exported app was not built (no export templates), expected 70–100 MB, unverified |
| Build | none | npm only | Rust (installed for this, with the user's OK) + MSVC build tools; first release build 2 min 10 s | Godot editor + export templates |
| The user, trying all three side by side | — | "Godot 比較順" | smooth (said "Tauri" when asked how it compares) | "比較順" |

Notes:

- The GPU timer is noisy in the browser shells (ANGLE / D3D11 timer queries); uncapped runs gave no
  usable browser GPU times. Godot's numbers come from its own render-time counter.
- Tauri memory: the benchmark summed two process filters that both matched the WebView2 processes;
  a live check with one filter gave 914 MB RAM and 552 MB GPU memory. `bench.mjs` is fixed.
- When the user compared the windows, a Rust release build was running at the same time, and the
  Electron window used `setOpacity` (a layered window). Either may explain why Electron felt less
  smooth; the benchmark shows no dropped frames for any of them.

What the numbers say: all four are fast enough with a lot of room. Godot needs the least GPU time
and never stalls, but uses the most memory and is a second code base. Tauri is tiny on disk and keeps
the one web code base.

**Decision (2026-10-23, the user): Tauri**, with the town drawn by the web renderer. Reasons: one code
base with the rest of Agent Skyline (panels, tracker, file lists stay as they are), 8 MB, about half of
Godot's memory, and smooth at the display rate in every scene. Godot's prototype stays in
`proto/town-render/godot/` for reference.

### Built: `desktop/` (2026-10-23)

`skyline --window` opens the city in the Tauri app in `desktop/` (built with cargo on first use,
10 MB). Checked on this machine:

- Pin, opacity (30–100 %, slider and Ctrl+Alt+Shift+Up/Down while focused) and close work from the
  page's title bar; position, size, pin and opacity are saved to `data/repos/<key>/window.json` on close.
- **Click-through works**: with it on, the window under the cursor is the one behind the city
  (`WS_EX_TRANSPARENT` set); Ctrl+Alt+Shift+C (global) turns it off again and the page's bar updates.
  It is only allowed while pinned, so an unpinned window that ignores clicks cannot get lost.
- The page is served by the local server, so Tauri treats it as remote: the window commands are
  declared in `build.rs` and allowed for `http://127.0.0.1:*` in `capabilities/default.json`.
- One window per repo: a second `skyline --window` reports the open one (PID in `window.pid`).
- Not done yet: `"window": true` in user settings, and an installer.

## Pieces

- `desktop/`: the chosen shell, with its own `package.json` (kept out of the root package so the
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
