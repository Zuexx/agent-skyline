# Step 5: Live activity and zones in the city

Goal: show what Claude Code is doing, live: which files it reads and writes, where each agent
is, what got blocked, and let the user lock districts by clicking them.

## Constraints

Same as step 4: everything under `codecity/web/`, JavaScript + JSX, no new npm packages.
Pure logic goes in `src/lib/` with vitest tests. Colors only in `src/theme.js`.

## Data

`GET /api/events` is Server-Sent Events. Each message is `data: <json>`:

```json
{ "ts": "2026-10-09T08:00:00.000Z", "session": "abc", "agent": null, "event": "PostToolUse",
  "tool": "Edit", "kind": "write", "paths": ["api/Anvil/Data/UnitOfWork.cs"], "detail": null }
```

`kind` is one of `read`, `write`, `search`, `exec`, `other`, `blocked`. Paths are repo-relative
with `/`, the same strings as building `path`. On connect the server replays up to 200 past
events, then streams new ones. Use the browser `EventSource` (it reconnects by itself).

`GET /api/zones` → `{ status, locked: string[] }`. `PUT /api/zones` with `{ locked }` → same shape.

## Part A — activity state, live colors, feed

### `src/lib/activity.js` (pure, tested)

- `emptyActivity()` → `{ files: {}, agents: {}, feed: [] }`
- `applyEvent(state, ev)` → new state (do not mutate the input):
  - Ignore events whose `kind` is not `read`, `write` or `blocked`, or that have no paths.
  - `agentKey = ev.agent ?? ev.session ?? "unknown"`.
  - For each path: `files[path]` = `{ reads, writes, blocked, lastRead, lastWrite, lastBlocked }`
    (counts and ISO timestamps), updated for the event's kind.
  - `agents[agentKey] = { path: <last path of the event>, ts: ev.ts, kind: ev.kind }`.
  - `feed` = this event prepended, max 50 entries.
- `agentColorIndex(agentKey, n)` → stable integer in `[0, n)` (simple string hash).
- `buildingTint(fileActivity, nowMs)` → one of `"blocked" | "read" | "written" | null`:
  - `"blocked"` if `lastBlocked` is within 3000 ms of `nowMs`,
  - else `"read"` if `lastRead` is within 4000 ms,
  - else `"written"` if `writes > 0`,
  - else `null`.

### `src/lib/useActivity.js`

React hook: opens `EventSource("/api/events")`, folds every message through `applyEvent`,
returns `{ activity, connected }`. `connected` is true after `onopen`, false after `onerror`.
Close the EventSource on unmount. Batch updates: collect incoming events and apply them at most
every 100 ms (the replay of 200 events must not cause 200 renders).

### Rendering

- `theme.js`: add `read` (blue), `written` (amber), `blocked` (red), `agentColors` (6 distinct
  colors that work on the light background).
- `Buildings.jsx`: color priority per instance: selected > hover > tint from `buildingTint` > base.
  Re-evaluate tints in `useFrame` at most 4 times per second, and only call `setColorAt` for
  instances whose color actually changed.
- `ui/Feed.jsx`: bottom-left panel, latest 20 feed entries: `HH:MM:SS`, a dot in the agent's
  color, kind label, path (truncate from the left if long). Clicking an entry selects that
  building (same selection state as clicking it in the scene).
- `ui/DetailPanel.jsx`: replace "No activity yet" with reads, writes, blocked counts and the last
  read / write time when the file has activity.
- `ui/TopBar.jsx`: add a live indicator: green dot + "Live" when connected, grey + "Offline" otherwise.

### Tests

`activity.test.js`: ignores search/exec; counts reads/writes/blocked; does not mutate input;
feed capped at 50 and newest first; agent falls back to session; `buildingTint` boundaries
(2999 ms vs 3001 ms for blocked, priority order); `agentColorIndex` is stable and in range.

## Part B — agent markers

`city/Agents.jsx`: for every agent in `activity.agents` whose path is a known building, draw a
small marker (an upside-down cone, radius 0.35, height 0.8) in the agent's color, floating 1.2
above that building's top, bobbing gently (`useFrame`, sine, amplitude 0.15). When the agent's
path changes, move the marker smoothly (lerp over ~300 ms). Agents with no event for 10 minutes
fade out (opacity) and are then not drawn. Show a small drei `Html` label with the first 6
characters of the agent key on hover of the marker only.

## Part C — locked zones

- Import the matcher from the hook code instead of copying it:
  `import { matchGlob } from "../../../lib/glob.mjs"` (adjust the relative path), and set
  `server.fs.allow` in `vite.config.js` so the dev server may serve that file.
- `src/lib/useZones.js`: loads `GET /api/zones`; exposes `{ locked, status, toggleDistrict(path) }`.
  `toggleDistrict(path)` adds or removes exactly `"<path>/**"` and PUTs the new list; on failure
  keep the old list and expose `error`.
- `Districts.jsx`: a district is "locked" if `"<path>/**"` is in `locked`; draw it in
  `theme.locked` (a light red). Buildings whose path matches any locked glob get a thin red cap
  (a flat box 0.9 × 0.08 × 0.9 on top) — draw these caps as a second InstancedMesh.
- `TopBar.jsx`: a "Lock zones" toggle button. While zone mode is on: the cursor is a crosshair,
  clicking a district (or a building, which then means its parent district) calls
  `toggleDistrict`; normal selection is disabled. The root district (path `""`) cannot be locked.
  Show `status: invalid` from the server as a red warning in the TopBar.

## Done when (each part)

`cd codecity/web && npm test && npm run build` pass, and no file outside `codecity/web/`
changed (except `vite.config.js` edits inside `web/`).
