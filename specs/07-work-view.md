# Step 7: Agents as entities, tasks as a flow

Goal: close the gap with the WareTrack reference (`waretrack/NOTES.md`). WareTrack works because
the scene has things that move (trucks, forklifts), each with a state, going through a flow
(order → pick → load → transit → unload), with KPI cards for the overview and a detail panel and
list for the specifics. Agent Skyline today has only the places: buildings change color, but the
agent itself, its task and where it is in that task are missing.

| WareTrack | Agent Skyline after this step |
|---|---|
| Trucks and forklifts in the scene | Each agent is a character in the scene (art from step 6) |
| Shipment timeline | Task timeline: Asked → Exploring → Changing → Checking → Done |
| KPI cards | Active agents · files changed (+/− lines) · blocked / out of scope · last test result |
| Truck detail panel | Agent panel: task, stage, files touched, last action, time spent |
| Docks / forklifts / trucks tabs | Agents / Files / Blocked tabs |
| Scene, panel and timeline linked | Selecting in any one selects in the others |

Status: draft, 2026-10-23. Built and tested with the `blocks` look first; step 6D gives it the
theme's UI skin.

## 7A: one set of data per repo (bug fix, do first)

Today every server and hook reads the same `data/zones.json` and `data/scope.json`
(`lib/paths.mjs`), and zone globs are repo-relative, so locking `api/**` in one repo locks
`api/` in every connected repo. All repos also append to one `data/events.jsonl`.

- Data moves to `data/repos/<key>/{events.jsonl,zones.json,scope.json}`, where `<key>` is the
  repo folder name plus a short hash of its absolute path.
- Hooks already get `--root`; `resolveLogFile/ZonesFile` take the root and return that repo's
  files. Environment overrides keep working for tests.
- First run: copy the old shared `zones.json` and `scope.json` into each connected repo's folder
  (so nothing that was locked becomes unlocked), keep the old `events.jsonl` read-only as history.
- Test: two repos, lock `api/**` in one, a write to `api/x` in the other is allowed.

## 7B: tasks and stages (pure logic)

`web/src/lib/tasks.js` (tested). A task is one turn of one session: it starts at a
`UserPromptSubmit` event and ends at the next `Stop`.

- New hook event: `UserPromptSubmit` is logged with the prompt's first line, cut to 120
  characters (stays on this machine, like the rest of the log). Sessions with no such event
  (pi, old logs) start a task at their first event.
- Stage from the task's events, latest wins:
  - `asked`: no tool use yet
  - `exploring`: reads and searches only
  - `changing`: at least one write
  - `checking`: an exec whose command looks like a test, build or lint run
    (`test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `dotnet test`, `npm run build`,
    `tsc`, `eslint`…); a later write moves it back to `changing`
  - `done`: `Stop`
- Interruptions shown on the timeline: blocked writes, writes outside the declared scope.
- Per task: start time, elapsed, files read, files written, lines +/− (from the working diff),
  blocked count, out-of-scope count, last test result (`passed` / `failed` / `unknown`, from the
  exec's output when the hook gives it, else `unknown`).

## 7C: screen

- **KPI cards** (top-left, replacing the compare summary when no branch is compared): active
  agents, files changed with +/− lines, blocked + out-of-scope count (red when > 0), last test
  result. Clicking a card filters the scene and the list to what it counts.
- **Task timeline** (bottom-left, above or replacing the feed): the five stages as WareTrack's
  shipment tracker, with the time each was reached and red marks for interruptions. One per
  active task; a picker switches between agents.
- **Agent panel** (right, when an agent is selected): name and color, task prompt, stage,
  elapsed time, current file, files touched (click to fly there), blocked / out-of-scope list.
- **Tabbed list** (bottom-right): Agents · Files touched · Blocked, each row selectable.
- **Linking**: one selection state for agent, file and task; the scene, panel, timeline and list
  all read and set it.

## 7D: scope that holds

- Scope gets a mode: `warn` (today) or `enforce`. In `enforce`, the guard hook denies writes
  outside the scope the same way it denies locked zones.
- Box-select → task: besides copying the prompt, set the scope to the selection in `enforce`
  mode with one click, so "work only on these files" is a guard, not a request.

## Order with step 6

7A → 6A → 7B → 7C → 6B → 6C → 7D → 6D. 7A first because it is a bug; 7B and 7C need no art and
make the `blocks` look useful on its own while the concept art is being made.
