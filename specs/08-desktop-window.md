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
**Godot**, which is renderer and window in one. Prototype in `proto/town-render/`. All three read the
same town pack (v4 town, 13 MB) and the same live state (`state.mjs`, which follows the server's
event stream), and draw the same things. Benchmark: `bench.mjs`, same agents (`--demo-fixed`),
10 s per scene.

| Measure | Web page (Chrome) | Electron 45 | Godot 4.7.2 |
|---|---|---|---|
| Looks | Same as the art proof of concept; characters slightly darker | same as web | Same as the proof of concept |
| Frame rate at the display rate (240 Hz), 1920×960 and 1920×1080 | 240, 0 frames over 20 ms | 240, 0 over 20 ms | 240, 0 over 20 ms |
| Same at 3840×1920 | 240, 0 over 20 ms | 99, 6 over 20 ms (window smaller than the canvas, scaled) | 152, 0 over 20 ms |
| Uncapped average fps, 1080p scenes | 1,160–1,230 | 1,475–1,520 | 930–1,190 |
| Uncapped worst frames | 50–90 ms stalls ~8×/s: the browser's frame queue throttling without vsync, gone at the display rate | same | none (p99 1.4 ms) |
| GPU time per frame, 1080p | 1.2–2.0 ms | not measured | 0.8–1.3 ms |
| GPU time per frame, 3840×1920 | 3.8 ms | not measured | 2.3 ms |
| RAM, all processes, at the display rate | 0.94–1.0 GB (Chrome tree, 8 processes) | 0.87–0.94 GB | 1.57 GB (to investigate: likely the 2 M-vertex grid kept on the CPU) |
| GPU memory (dedicated) | 510–540 MB | 515–550 MB | 840 MB |
| Load (pack to first frame, inside the app) | 0.2–0.3 s | 0.2–0.3 s | 0.37 s |
| Pin on top | not possible in a tab | `alwaysOnTop` (set; not yet checked by eye) | flag set and read back |
| Opacity | not possible in a tab | `setOpacity` (set; not yet checked by eye) | per-pixel transparency, read back; not yet checked by eye |
| Frameless, resize | — | yes / yes | yes / yes |
| Click-through | — | not tested yet | not tested yet |
| Size on disk | — | 357 MB unpacked runtime | 173 MB editor; an exported app was not built (no export templates installed) |
| Toolchain | none | npm only | Godot editor + export templates |

**Tauri: not tested.** It needs a Rust toolchain, which is not installed on this machine; installing it
is the user's call. WebView2 (Edge 153) is installed, so its rendering should match the web column, but
that is unverified.

What the numbers say so far: all three are fast enough for this scene with a lot of room (a 240 Hz
display never dropped a frame). Godot needs about 35–45 % less GPU time and shows no stalls when
uncapped; the web stack uses less RAM and needs no second code base (the rest of Agent Skyline is a
web page). No choice yet.

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
