# CodeCity: a control tower for Claude Code

[繁體中文](NOTES.zh-TW.md)

> These are the design notes written before building, kept as they were. What was actually built,
> and where it differs, is in `PROGRESS.md`.

- Origin: the general formula from the WareTrack teardown (`../waretrack/NOTES.md`), applied to code.
- Scope: a personal project that runs entirely on this machine and uses no company resources (the
  earlier Azure AI idea was dropped).
- Status: everything in the build order is built except LLM queries: events, zones, the city, box-select task assignment, jumping to VS Code, session replay, git
  diff comparison, dependency roads and the risk-ordered review (see `PROGRESS.md`).
  Architecture boundary checks are not built.

## In one sentence

Draw the repo as a city in order to **supervise and control Claude Code**: see where it went, mark
zones it must not touch, and assign work by selecting buildings. It is not a general code
visualization tool.

## Why not a general CodeCity

Code visualization has been researched for over twenty years, and almost none of it is used in
daily work.

- **What the evidence supports**: the CodeCity controlled experiment (Wettel et al., ICSE 2011)
  showed that cities improve correctness and speed on **overview** questions (the largest classes,
  the most complex modules).
- **Why it fails**: daily work needs precise detail, and a city gives a blurry overview. It feels
  cool in week one and nobody opens it by week three.

Splitting each feature into "the analysis behind it" and "the 3D presentation":

| Feature | Is the analysis useful | Does 3D add anything |
|---|---|---|
| PR impact | ✅ | ⚪ a list of affected files gives 80% of the value |
| Hotspots (high churn, low coverage) | ✅ | ❌ a sorted table reads better |
| Suggested reviewers, bus factor | ✅ | ❌ a table is enough |
| Watching Claude Code work | ✅ | ⚪ `git diff --stat` is enough for one session; the city wins with several agents in parallel |
| First look at an unfamiliar repo | ✅ | ✅ the case the research supports |
| Explaining a system to non-engineers | ✅ | ✅ |
| Fly-through camera, voice, narrated tours | ❌ | ❌ pure show-off |

Conclusion: the real value is in the analysis, and 3D helps only in a few cases. To become a
productivity tool, it needs a different purpose.

## What makes a visualization a productivity tool

Flame graphs, Google Maps, Git graphs and Grafana are visualizations people really use every day.
They all:

1. **Answer one specific question**, rather than showing everything.
2. **Are already in front of you when needed**, with nothing to open.
3. **Lead directly to an action**.
4. **Are much faster than the alternative**.

The question this project answers: **"What did Claude Code touch? Did it go out of scope?"** It
comes up every time an agent runs on its own, and neither terminal output nor `git diff --stat`
shows "scope" or "out of bounds". As AI writes more of the code and people shift from writing to
supervising, this need only grows.

## The city mapping

| Code | City |
|---|---|
| Folder, module | Block |
| File | Building |
| Line count | Building height |
| Dependencies, calls | Roads |
| Claude Code session, subagent | Characters (one color each) |
| File being read | Building lights up |
| File being changed | Building gets scaffolding |
| Locked area | No-go zone |

## Core features

### 1. Know at a glance
- While Claude Code runs, the city sits on a second screen and needs no interaction.
- When a character leaves the expected area (asked to change the frontend, it goes into the
  database), it is visible at a glance.
- Several agents entering the same building signals a possible conflict.

### 2. No-go zones ⭐ something a table cannot do
- Select blocks in the city and mark them "locked".
- When Claude Code's `PreToolUse` hook receives a write, it checks whether the target is in a
  locked zone and blocks it if so.
- The blocked building flashes red.
- This turns "AI, don't touch this" from a verbal agreement in the prompt into a guardrail that is
  visible and actually enforced.

### 3. Assign work by selection
- Select a few buildings, type "add tests for these files", and the selected file list goes to
  Claude Code as the task scope.
- The city is an input surface, not only an output. This is the biggest difference from existing
  CodeCity-like tools.

### 4. Jump to code
- Clicking a building opens it in VS Code (`vscode://file/...`) or shows this session's diff for it.
- The city is for finding; details go back to familiar tools.

### 5. Session replay and review
- Replay the agent's path: what it read first, what it changed, whether it took detours.
- Changed buildings are ordered by risk (high churn, low coverage first), to click through and
  read the diffs in order.

## Possible later features (low priority)

- **PR overlay**: changed buildings get scaffolding, new files are new buildings, deleted files
  become ruins, and buildings that depend on them light up too.
- **Architecture boundary checks**: roads that cross layers they should not are shown in red.
- **Local LLM queries**: the LLM returns a scene-command JSON (which buildings to light, which path
  to walk, how to move the camera), not just text. For example:

  ```json
  {
    "highlight": ["src/payment/charge.ts"],
    "path": ["api/checkout.ts", "payment/charge.ts", "infra/stripe.ts"],
    "camera": "fly_along_path",
    "answer": "Checkout enters the payment flow, goes through charge, and finally calls Stripe."
  }
  ```

### Later: an overworld style (Zelda-like terrain)

Asked for on 2026-10-09; parked as a future improvement. A second scene style next to the
minimal city, switchable, not a replacement. The terrain has to carry data, or it is just
prettier boxes:

| Code | Overworld |
|---|---|
| Top-level folder | A region with its own landform (`api` mountains, `app` plains, `docs` a lakeside town, `openspec` forest…) |
| File | A building in that region (tests as watchtowers, docs as cottages); clicking and box-select still work |
| Line count | Building height, unchanged; buildings stand on level pads or terraces so heights stay comparable |
| Dependency roads | Paths or rivers on the ground instead of arcs |
| Files not touched this session | Fog of war, lifted as the agent reads: answers "where has it looked?" |
| Write / blocked | A campfire lighting up / a smoke signal |

Look: cel shading, wind-blown grass, water, distance fog and sky, following the night/day theme.
All procedural (no asset licensing); CC0 low-poly packs (Quaternius, Kenney nature) or ComfyUI
textures later if more detail is wanted.

Plan in two stages: (1) terrain, regional landforms, cel shading, fog of war; (2) grass, water,
paths and rivers, props. Measure performance at 20,000 files before stage 2: grass and props
will need thinning or zoom-dependent display, and the 60 fps of the minimal city may not hold.

### Later: people who do not use git

Raised on 2026-10-09; parked. CodeCity needs the watched folder to be a git repository, and a
command line to start. Non-programmers have neither habit. Planned in three layers:

1. **A shadow repository**: CodeCity keeps its own git history for the folder inside its data
   directory (`git --git-dir=<codecity data>/shadow/<key> --work-tree=<folder>`), so the folder
   gets no `.git` and nothing in it changes. A snapshot at the start of each working session is
   the baseline, which keeps "what did the agent change" with per-file diffs, the review list and
   churn working. The git program is still needed, but Claude Code on Windows already requires
   Git for Windows.
2. **No git at all**: walk the folder directly (skipping `node_modules`, hidden folders and the
   like). The city, live activity, zones, scope checks and alerts still work; diffs and branch
   comparison are hidden, since there is no baseline.
3. **Double-click start**: a launcher that asks for a folder, installs the hooks, starts the
   server and opens the browser (a Windows `.cmd` with a folder picker first; a desktop app if it
   is ever distributed).

## Technology

| Purpose | Choice |
|---|---|
| Agent events and no-go zones | Claude Code hooks (`PreToolUse`, `PostToolUse`) |
| Event delivery | A small local server pushing to the front end over WebSocket |
| Rendering | React Three Fiber; instancing for large repos |
| Code structure and dependencies | CodeGraph (already available), tree-sitter as a fallback |
| History and owners | `git log`, `git blame` |
| LLM (optional) | LM Studio, currently Qwen3.8-27B, with JSON-schema structured output |

**VRAM limit**: LM Studio must leave 4 to 6 GB of VRAM free and must not offload.

## Design notes

- **Stable layout**: building positions are fixed by path and must not move after a commit,
  otherwise nobody can remember which module is where.
- **The city navigates, it does not hold detail**: the diff is still what you read; the city and
  the diff panel are linked.
- **Large repos**: tens of thousands of files use instancing, and zoom level decides how deep the
  display goes.
- **Zones must be reliable**: whether the hook blocks a write cannot depend on the front end being
  open. Zone settings are stored in a file that the hook reads directly.

## Build order

The first two steps need no 3D and are useful on their own:

1. **Event log**: a hook records Claude Code's reads and writes (text only).
2. **No-go zones**: a settings file lists locked paths and `PreToolUse` blocks writes (text only).
3. **The city**: live events, and selecting zones in the city (written back to the same file).
4. **Assign work by selection, jump to VS Code, session replay**.
5. PR overlay and LLM queries last, or never.

## Success criterion

For two weeks in a row, the city gets opened every time Claude Code is started. If that happens,
it is a productivity tool; if not, admit it is a learning project (React Three Fiber, Claude Code
hooks and local LLM structured output are still worth learning).

## Open questions

- Which repo to try first? One that is familiar and where Claude Code often runs on its own.
- Package the front end as a desktop app (Tauri, Electron), or keep it a local web page?
- Can CodeGraph's output be used directly, or does it need converting to a `city.json`?
- Zone granularity: path globs only, or down to functions?
