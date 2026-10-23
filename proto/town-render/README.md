# Town renderer comparison (specs/08, 8A)

The painted town (specs/09, specs/10) drawn three ways from the same town pack and the same live
state, to choose the renderer and the desktop shell by measurement.

| Path | What |
|---|---|
| `state.mjs` | Bridge: follows Agent Skyline's event stream (`/api/events` on 4477) and serves `/state` (agents, their buildings and actions, recently written buildings) on 4478; also serves the web prototype and the pack. `--demo` / `--demo-fixed` for made-up agents. |
| `web/` | three.js renderer (`town.js`): relief rebuilt from the depth map on the GPU, live window light, sprites, barrier, scaffold, depth of field, bloom. |
| `electron/` | Electron shell around the web page: pin, opacity, frameless. `npm install` here first. |
| `tauri/` | Tauri 2 shell around the web page (system WebView2): pin, frameless, transparent window; the page fades itself (`?opacity=`). `cargo build --release` here first. |
| `godot/` | Godot 4.7 renderer, same behaviour (`town.gd`). |
| `bench.mjs` | Benchmark: fps, frame times, GPU time, RAM and GPU memory of each. Results in `bench-results*.json`. |
| `run.mjs` | Try one as a window, live: `node proto/town-render/run.mjs godot --on-top --opacity=0.85` |

The town pack is built from the art proof of concept (kept out of git) by
`docs/concept/town_poc/work_pack/mkpack.py`; it lands in `docs/concept/town_poc/pack_v4/`.

Results and the decision go in `specs/08-desktop-window.md`.
