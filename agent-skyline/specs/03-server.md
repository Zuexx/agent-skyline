# Step 3: Server (scan, layout, live events, zones API)

Goal: a local HTTP server that turns a git repo into city layout JSON, streams the event log
live, and reads/writes the zones file. No UI in this step.

## Constraints

Node ES modules, **zero npm dependencies** (`node:http`, `node:fs`, `node:child_process`, ...),
`node:test`, Windows + POSIX, all files under `agent-skyline/`. Reuse `lib/paths.mjs`
(`resolveLogFile`, `resolveZonesFile`) and `lib/zones.mjs` (`loadZones`). Existing tests must keep passing.

## Files

```
agent-skyline/
├── server/scan.mjs       # list files + count lines
├── server/layout.mjs     # pure: files -> buildings + districts
├── server/tail.mjs       # follow a JSONL file
├── server/server.mjs     # HTTP entry point
└── test/scan.test.mjs, layout.test.mjs, tail.test.mjs, server.test.mjs
```

## `server/scan.mjs`

`scanRepo(root)` → `{ root, files: [{ path, lines }] }`

- File list: `git ls-files -z` run with `cwd: root` (use `execFileSync`, not a shell string).
  Paths use `/`. Sort ascending.
- `lines`: number of `\n` in the file, +1 if the file is non-empty and does not end with `\n`.
  Binary files (a `\0` byte in the first 8000 bytes) and files over 2 MB → `lines: 0`.
  A file listed by git but missing on disk → skip it.

## `server/layout.mjs`

`layout(files)` → `{ districts: [...], buildings: [...], width, depth }`. Pure and deterministic.

Build a directory tree from the paths. Lay out each directory recursively:

- Children order: subdirectories first (name ascending), then files (name ascending).
- Each **file** is a 1 x 1 footprint.
- Files of one directory form a grid: `cols = ceil(sqrt(fileCount))`, cell pitch 1.5 (1 + 0.5 gap).
- Each **subdirectory** is laid out recursively and becomes a rectangle.
- Place the file grid (as one rectangle) and the subdirectory rectangles with shelf packing:
  left to right, gap 1, start a new row when the next item would exceed
  `maxRowWidth = max(widest item, ceil(sqrt(sum of item areas)) * 1.3)`.
  Row height = tallest item in the row; rows separated by gap 1.
- Wrap the result in padding 1 on every side. That rectangle is the directory's district.

Output, all coordinates absolute, origin at the root district's top-left corner, x right, z down:

```json
{
  "width": 120.5, "depth": 80,
  "districts": [{ "path": "api/Anvil", "depth": 2, "x": 0, "z": 0, "w": 10, "d": 6 }],
  "buildings": [{ "path": "api/Anvil/Data/UnitOfWork.cs", "x": 3, "z": 4, "lines": 110, "height": 2.04 }]
}
```

- `x`, `z` of a building = its footprint's top-left corner. Root district has `path: ""`, `depth: 0`.
- `height = max(0.3, log10(lines + 1))`.
- Heights do not influence positions (stable layout: editing a file never moves anything).

## `server/tail.mjs`

`tailJsonl(file, { fromStart, onEvent, intervalMs = 300 })` → `{ close() }`

- Poll with `fs.stat` every `intervalMs` (do not rely on `fs.watch`; it is unreliable on Windows).
- `fromStart: true` emits existing lines first; otherwise starts at the current end of file.
- Only emit complete lines (keep a partial trailing line buffered until its `\n` arrives).
- Skip lines that are not valid JSON objects.
- File missing → wait for it to appear. File shrinks (truncated) → restart from 0.

## `server/server.mjs`

`node server/server.mjs --repo <path> [--port 4477]`

Also export `createServer({ repo, logFile, zonesFile })` returning an `http.Server` (not
listening) so tests can use port 0.

- Listen on **127.0.0.1 only**.
- `GET /api/city` → `{ repo, ...layout(scanRepo(repo).files) }`. Cache the result;
  `GET /api/city?rescan=1` recomputes.
- `GET /api/events` → Server-Sent Events (`Content-Type: text/event-stream`,
  `Cache-Control: no-cache`). On connect send the last 200 events from the log (fewer if the
  file is shorter), then every new event, each as `data: <json>\n\n`. Send `: ping\n\n` every
  15 s. Stop tailing when the client disconnects.
- `GET /api/zones` → `{ status, locked }` from `loadZones` (`locked: []` unless status ok).
- `PUT /api/zones` with body `{ "locked": string[] }` → validate (array of non-empty strings,
  max 200 entries, body max 64 KB), write to the zones file atomically (write `<file>.tmp`,
  then `rename`), respond with the new `{ status, locked }`. Invalid → 400 `{ error }`.
- `GET /` and other paths → serve static files from `agent-skyline/web/dist` if that folder exists
  (prevent path traversal outside it; unknown file → serve `index.html`), else 404 text
  `web UI not built`.
- Unknown `/api/*` → 404 JSON.

## Tests

- scan: create a temp dir, `git init`, add a text file (3 lines, no trailing newline), a binary
  file, commit nothing (use `git add` so ls-files lists them). Assert paths and line counts.
- layout: no two buildings overlap; every file appears exactly once; same input twice gives
  identical output; changing only `lines` changes heights but not any `x`/`z`; a building lies
  inside its directory's district rectangle.
- tail: existing lines with `fromStart`; appended line arrives; partial line not emitted until
  completed; truncation restarts.
- server: on port 0 with temp log/zones files and a temp git repo:
  `/api/city` shape; `PUT` then `GET /api/zones` round trip; `PUT` invalid → 400;
  `/api/events` receives an event appended after connecting (read the stream, abort after it);
  path traversal like `/../package.json` does not escape `web/dist`.

## Done when

`cd agent-skyline && npm test` passes (all old and new tests), no file outside `agent-skyline/` changed.
