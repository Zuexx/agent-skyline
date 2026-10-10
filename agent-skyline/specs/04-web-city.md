# Step 4: Web UI — static city

Goal: render the city from `GET /api/city` in the browser with React Three Fiber, with hover
and click-to-inspect. Live events come in step 5; this step only needs the static city.

## Constraints

- Everything under `agent-skyline/web/`. Do not modify files outside `agent-skyline/web/`.
- Vite + React + JavaScript (JSX, no TypeScript). Packages allowed: `react`, `react-dom`,
  `three`, `@react-three/fiber`, `@react-three/drei`, and dev: `vite`, `@vitejs/plugin-react`,
  `vitest`. Nothing else.
- Use a separate `agent-skyline/web/package.json` (the root `agent-skyline/package.json` stays dependency-free).
- Scripts: `dev` (vite), `build` (vite build → `web/dist`), `test` (vitest run).
- Vite dev server proxies `/api` to `http://127.0.0.1:4477` (the step 3 server).

## Data

```json
{
  "repo": "D:\\Labs\\forgekit",
  "width": 120.5, "depth": 80,
  "districts": [{ "path": "api/Anvil", "depth": 2, "x": 0, "z": 0, "w": 10, "d": 6 }],
  "buildings": [{ "path": "api/Anvil/Data/UnitOfWork.cs", "x": 3, "z": 4, "lines": 110, "height": 2.04 }]
}
```

Coordinates: x right, z down, building footprint 1 x 1 with top-left at (x, z). In three.js
place a building's center at `(x + 0.5, height / 2 + base, z + 0.5)` where `base` is the top of
its district slab. Center the whole city at the origin (subtract width/2, depth/2).

## Files

```
web/
├── package.json, vite.config.js, index.html
└── src/
    ├── main.jsx
    ├── App.jsx              # fetch city, layout of panels
    ├── theme.js             # all colors in one place
    ├── city/City.jsx        # districts + buildings
    ├── city/Buildings.jsx   # ONE InstancedMesh for all buildings
    ├── city/Districts.jsx   # flat slabs
    ├── ui/TopBar.jsx
    ├── ui/DetailPanel.jsx
    └── lib/                 # pure helpers + tests (*.test.js)
```

## Scene

- Background and palette: light, calm (white / pale blue / navy), like a low-poly isometric
  dashboard. Define colors in `theme.js` only.
- Camera: `OrthographicCamera` (drei) looking from an isometric angle (e.g. position (1,1,1)
  direction), zoomed to fit the city on load. Controls: drei `MapControls` (pan, zoom, rotate
  limited so the camera stays above ground).
- Districts: thin boxes (height 0.1), stacked by `depth` so nested districts sit on top of their
  parent (`base = depth * 0.1`). Color gets slightly darker per depth level.
- Buildings: a single `InstancedMesh` of unit boxes, scaled per instance to (0.9, height, 0.9).
  Must stay smooth with 5,000 buildings. Use per-instance colors (`setColorAt`).
- One directional light + ambient light. No shadows needed.

## Interaction

- Hover a building → it turns the highlight color; a small HTML label (drei `Html`) shows the path.
- Click a building → selected (distinct color, stays until another click or Esc). The right-side
  `DetailPanel` shows: path, lines, district path, and a placeholder "No activity yet".
- Click empty space → clear selection.
- `TopBar`: repo path, building count, district count.

## Pure helpers (with vitest tests)

- `lib/geometry.js`: `buildingTransform(building, districtDepthByPath)` → `{ position, scale }`
  (use the building's parent directory to find its district depth; root files use depth 0);
  `cityBounds(city)` → center + size for camera fitting.
- `lib/parent.js`: `parentDir("a/b/c.ts")` → `"a/b"`, `parentDir("c.ts")` → `""`.

## Done when

- `cd agent-skyline/web && npm install && npm test && npm run build` all succeed.
- No file outside `agent-skyline/web/` changed (besides the generated `web/dist` and `node_modules`).
