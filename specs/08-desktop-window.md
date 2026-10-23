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
