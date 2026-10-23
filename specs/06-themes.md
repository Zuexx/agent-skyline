# Step 6: Theme packs

Goal: the city's whole look — palette, buildings, agents, effects, camera, post-processing and UI
skin — comes from a theme pack that can be added by dropping in a folder and switched from the
toolbar without a reload. The current block city becomes one built-in pack (`blocks`); the new
default pack is `dq-hd2d`: Akira Toriyama / Dragon Quest style with HD-2D rendering (low-poly
buildings with pixel-art textures, 2D pixel characters as billboards, tilt-shift depth of field,
soft bloom). All characters and props are original; only the style is borrowed.

Status: draft, 2026-10-23. Concept art comes first (`docs/concept/`); the numbers in "Budgets"
are targets to confirm with `bench/perf.mjs` before step 6C starts.

## Constraints

- Everything under `web/` and `server/`, JavaScript + JSX, no new npm packages
  (`postprocessing` already has `TiltShiftEffect`, `BloomEffect` and `VignetteEffect`).
- Pure logic in `web/src/lib/` with vitest tests; server code with `node --test`.
- A pack is data, never code: no scripts, no shaders, no remote URLs. The app only reads JSON,
  images (PNG/WebP), fonts (WOFF2) and audio (OGG) from it.
- A broken or missing pack never leaves an empty screen: fall back to `blocks` and show a toast.

## Budgets

| What | Budget |
|---|---|
| Frame rate, 20,000 files, overview zoom | ≥ 55 fps (same bench as `docs/performance.md`) |
| Draw calls for buildings | 1 (one InstancedMesh, as today) |
| Draw calls for agents | 1 (one instanced billboard mesh) |
| Pack size on disk | ≤ 10 MB |
| Atlas | one or two textures, each ≤ 2048 × 2048 |
| GPU memory for a pack | ≤ 64 MB of textures |
| Theme switch | < 1 s, and memory returns to its earlier level after 10 switches |
| Hidden tab | renders nothing (`frameloop="demand"` while `document.hidden`) |

Post-processing has three quality levels (`high`: tilt-shift + bloom + vignette; `medium`:
bloom only; `low`: none). Start at the pack's level and step down when the average frame time
stays above 20 ms for 3 s; never step back up within the same session.

## Pack layout

```
<pack id>/
  theme.json        required
  atlas.png         sprites and building textures (or atlas.webp)
  atlas.json        frame rectangles in the atlas, by name
  ui/               optional: window border (9-slice PNG), font (WOFF2), icons
  sfx/              optional: short OGG clips
```

Where packs live:

- built-in: `web/public/themes/<id>/` (shipped with the app; `blocks` and `dq-hd2d`)
- user: `~/.agent-skyline/themes/<id>/` (dropped in by the user; survives updates)

A user pack with the same id as a built-in one wins.

## `theme.json`

```json
{
  "id": "dq-hd2d",
  "name": { "en": "Quest Town", "zh-TW": "勇者小鎮" },
  "version": 1,
  "renderer": "sprites",
  "variants": {
    "day":   { "palette": { "background": "#bfe3ff", "read": "#3aa0ff", "...": "..." }, "light": { } },
    "night": { "palette": { "...": "..." }, "light": { } }
  },
  "camera": { "mode": "fixed", "pitchDeg": 35, "rotateStepDeg": 90 },
  "post": { "quality": "high", "tiltShift": { "focusArea": 0.35, "feather": 0.3 }, "bloom": { "threshold": 0.8 } },
  "buildings": {
    "code":   ["code-s", "code-m", "code-l"],
    "test":   ["test-s", "test-m", "test-l"],
    "docs":   ["docs-s", "docs-m", "docs-l"],
    "config": ["config-s", "config-m", "config-l"],
    "other":  ["house-s", "house-m", "house-l"]
  },
  "agents": [
    { "id": "hero",   "color": "#ff9a3c", "frames": { "idle": ["hero-idle-0", "hero-idle-1"], "walk": ["..."], "work": ["..."] } },
    { "id": "mage",   "color": "#a46cff", "frames": { "...": [] } },
    { "id": "priest", "color": "#2ec4c4", "frames": { "...": [] } }
  ],
  "effects": { "scaffold": "fx-scaffold", "readGlow": "fx-window", "blocked": "fx-alert", "barrier": "fx-barrier" },
  "ui": { "skin": "window", "border": "ui/window.png", "borderSlice": 8, "font": "ui/font.woff2", "feedStyle": "battle" }
}
```

- `palette` holds every key `src/theme.js` has today, so the `blocks` pack is today's two
  palettes moved into JSON, with no visual change.
- `variants` replaces night/day: the existing "auto" preference picks `night` or `day` from the
  OS setting; a pack with one variant ignores it.
- `renderer: "blocks"` ignores `buildings`, `agents` and `effects`.
- Unknown keys are ignored; missing optional keys take the `blocks` value.

## Pieces

### Server

- `GET /api/themes` → `[{ id, name, version, source: "builtin" | "user", ok, error? }]`.
  Validation reads only `theme.json` (size limit 64 KB).
- `GET /themes/<id>/<path>` serves a pack file. Reject `..`, absolute paths, symlinks that leave
  the pack folder, and any extension outside the list in Constraints.

### Web

- `src/lib/themePack.js` (pure, tested): `validatePack(json)` → `{ ok, pack, errors }`, filling
  defaults; `resolvePalette(pack, variant)`.
- `src/lib/fileKind.js` (pure, tested): `fileKind(path)` → `code | test | docs | config | other`;
  `sizeTier(lines)` → `0 | 1 | 2` (thresholds from the repo's line-count percentiles, so a small
  repo still gets all three tiers).
- `src/lib/useThemePack.js`: loads the chosen pack, its atlas (as a `THREE.Texture`, nearest-neighbour
  filtering, mipmaps on), and disposes the previous textures, materials and fonts on switch.
- `src/theme.js` keeps the live `theme` object and `lit()`; `applyTheme` takes a resolved palette.
- `city/City.jsx` picks `BlockBuildings` (today's `Buildings.jsx`) or `SpriteBuildings` by
  `pack.renderer`.
- `city/SpriteBuildings.jsx`: one InstancedMesh, one shared low-poly house geometry (box + roof),
  per-instance attributes `atlasRect` (vec4) and `tint` (vec3); a small `onBeforeCompile` patch
  on a standard material reads them. Height still follows line count. Far zoom (camera above a
  threshold) switches to flat roof colors with no texture lookup.
- `city/SpriteAgents.jsx`: one instanced billboard; per-instance frame index advances in
  `useFrame` at 8 fps; walking interpolates along the road between the last two buildings and
  leaves a fading trail (one shared line geometry, at most 64 points per agent).
- Effects (scaffold on written buildings, window glow on read, `!` on blocked, barrier around
  locked districts) are instanced the same way, one draw call per effect kind.
- `ui/`: panels read CSS variables set from the pack (`--panel-bg`, `--panel-border-image`,
  `--font`); `feedStyle: "battle"` renders feed lines as battle messages through i18n
  (e.g. "Claude 1 searched JwksProvider.cs!").
- Top bar: a theme menu next to the night/day switch, listing `/api/themes`; broken packs are
  shown disabled with their error.

## Order

| Part | What | Visible change |
|---|---|---|
| 6A | Pack format, server routes, `blocks` pack, theme menu | none (same look, now from a pack) |
| 6B | Sprite renderer with a placeholder atlas, fixed camera, post quality levels, perf bench | new renderer, rough art |
| 6C | `dq-hd2d` art from the concept sheets, day and night | the new default look |
| 6D | UI skin and battle-message feed | DQ windows and text |

Each part ends with tests passing, the perf bench at 20,000 files within budget, and a browser
check of switching packs back and forth.

## 6B results (2026-10-23)

Both building looks are in `web/src/city/looks.js`, chosen per pack with `buildings.style`
(`"model"` or `"billboard"`), drawn from placeholder art made in code (`city/protoAtlas.js`) until
real art exists. Measured with `bench/perf.mjs` (headless Chrome, RTX 4090, D3D11, 1600×900, no
frame cap) on the 20,000-file synthetic repo, with 3 simulated agents sending 10 events a second:

| Look | Post level | fps | JS heap | First load |
|---|---|---:|---:|---:|
| Blocks (night) | bloom | 238 | 36 MB | 222 ms |
| model | high (tilt-shift + bloom + vignette) | 238 | 39 MB | 226 ms |
| billboard | high | 237 | 38 MB | 226 ms |

Not tested: a weaker GPU, and the quality step-down under real load (it never triggered here).
The tilt-shift at `focusArea 0.45, feather 0.3` is too subtle to see; tune it with the real art.
Billboards only face the camera at rest; during the 0.35 s turn they show at an angle.
The choice between the looks is the user's, after seeing both with real art.
