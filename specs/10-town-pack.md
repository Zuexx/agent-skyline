# Step 10: Town pack — the handoff between Agent Skyline and the art pipeline

Status: draft, 2026-10-23. Written after the first town proof of concept
(`docs/concept/town_poc/README.md`, kept out of git). The visual rules are in
`09-visual-language.zh-TW.md`; this file only fixes what goes in and what comes out.

## Roles

```
Agent Skyline ──layout.json──▶ art pipeline (scripts + the skyline-town-art skill) ──town pack──▶ Agent Skyline renders it
```

- **Agent Skyline** decides *what* is in the town: which folder is which building, how big, where,
  which roads. It writes `layout.json`.
- **The art pipeline** decides *how it looks*: it paints the town to match the layout (Qwen-Image),
  turns the painting into 2.5D (MoGe-3), finds where each building really ended up, and packs
  everything into a town pack. It lives outside this repo (it depends on the local ComfyUI and
  MoGe install): scripts runnable from the command line, wrapped by a user-level skill
  (`~/.claude/skills/skyline-town-art/`).
- **The renderer** (web or desktop, chosen in step 8) only reads the town pack. Nothing in the pack
  is engine-specific.

## `layout.json` (Agent Skyline → pipeline)

```json
{
  "version": 1,
  "layoutHash": "sha1 of the fields below, so a pack can say which layout it was painted for",
  "units": "metres",
  "camera": { "pitchDeg": -26, "fovDeg": 36, "target": [0, 2], "distance": 104 },
  "buildings": [
    { "id": "web/src/city", "kind": "code", "size": 2, "variant": 1, "files": 16, "x": -28, "z": -8, "footprint": 7 }
  ],
  "roads": [
    { "from": "web/src/city", "to": "web/src/lib", "width": 3.2, "points": [[-28, -4], [-16, -4]] }
  ],
  "plazas": [{ "x": 0, "z": 0, "r": 5 }],
  "free": [{ "x": 30, "z": 20, "r": 12 }]
}
```

- `id` is the folder path (`(root)` for the repo root); it is the key everything else refers to.
- `kind`: `code | test | docs | config | asset | root`; `size`: 0 / 1 / 2; `variant`: which of the
  2–3 looks of that kind (fixed per folder, see 09 §2.1).
- `free`: open ground the painter may fill with trees, fields and props (09 §2.3).
- For a big repo (09 §8) there is one `layout.json` for the overview map, where each building is a
  walled town (`kind: "district"`), plus one per district.

## Town pack (pipeline → Agent Skyline)

A folder in the theme pack format (`06-themes.md`), `renderer: "painted"`:

```
<pack>/
  theme.json            manifest (below)
  bg/day.webp           painted town, up to 4096 x 2048
  bg/day_depth.png      16-bit depth, up to 2048 x 1024, same framing
  bg/day_windows.png    mask: each building's windows in its own colour index (for "read" glow)
  bg/night.webp, bg/night_depth.png, bg/night_windows.png
  sprites/...           characters and effects: albedo + normal per frame
```

`theme.json` adds, per variant (`day`, `night`):

| Field | Meaning |
|---|---|
| `background` | `{ albedo, depth, depthNear, depthFar, windows }` |
| `camera` | the camera the painting is seen from: `{ fovDeg, position, lookAt }` in metres, plus the fitted ground plane (`groundNormal`, `groundY`) |
| `buildings` | `[{ id, screen: [u, v], world: [x, y, z], height, door: [x, y, z], windowIndex }]` — `screen` is the front-bottom centre in the painting (0–1), `world` the same point in 3D; the renderer anchors scaffolds, flags, characters and labels here |
| `lights` | `[{ kind: "lamp" | "fire" | "window", position, color, intensity, range }]`, detected from the night painting |
| `sprites` | characters (`hero`, `mage`, `priest`, …) with poses and frames, and effects (scaffold per size, barrier, `!`, `?`, `zzz`, magic circle, flags…), each with `pivot` and `pixelsPerMetre` |
| `buildings[].layout` | where the layout put the folder, `[x, z]` metres |
| `layoutToPixel` | 3×3 homography from layout metres to depth-map pixels, fitted on the painted buildings |
| `provenance` | models, weights, seeds, prompts, `layoutHash` — enough to repaint the same way |

**No meshes in the pack.** The proof of concept shipped a 90 MB relief mesh per variant; the
renderer instead builds a grid from the depth map (displacement), so the pack stays small and any
engine can read it.

## Budgets

| Item | Budget |
|---|---|
| Whole pack, day + night | ≤ 25 MB |
| Painted background | ≤ 4096 × 2048, WebP |
| Depth map | ≤ 2048 × 1024, 16-bit PNG |
| Sprites | one atlas per map, ≤ 2048 × 2048 |
| Render | same as `06-themes.md` (the PoC ran at 770–1,000 fps on the RTX 4090, 0.4 GB VRAM) |

## When to repaint

- A pack records the `layoutHash` it was painted for. Agent Skyline compares it with the current
  layout.
- Small changes (a new file, a folder's size tier changing) never repaint: they show as overlays.
- A new or removed folder shows at once as a sprite placeholder building on open ground
  (09 §11); the town is repainted later, when the user asks or when the differences pass a
  threshold (to be set).
- Until then (built 2026-10-23, `web/src/town/townLayout.js`): the pack lists `lots`, open ground in
  the painting checked by eye (layout metres, top level of `theme.json`). Each folder the painting lacks
  takes the free lot nearest to where its street would continue and shows as a construction site with
  its name. When the lots run out, the extra folders have no site and the town needs a repaint.
  Folders are grouped as the painting was (split a folder over 30 files into subfolders), and a
  subfolder under 5 files stays in the folder above (user decision); a painted folder keeps its house.
- Repainting runs in the background through the pipeline's command line; the old pack stays in use
  until the new one passes the checks below.

## Checks a pack must pass

1. Every `buildings[].id` in `layout.json` appears in the pack, within 60 px of where the layout
   put it (the PoC needed height-map correction for drifts of 0–60 px).
2. No legible text in the painting (signs are blank; labels are drawn by the renderer).
3. Size budgets above.
4. Day and night frame the same scene (each has its own `buildings` and `camera`, since repainting
   shifts details by a few pixels).

## Open

- The renderer (Godot or the web page) is chosen in step 8, by measurement.
- The repaint threshold.
- How the big-repo overview map and its districts link (one pack per level, or one pack holding
  all levels).
