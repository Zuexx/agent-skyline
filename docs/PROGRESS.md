# Agent Skyline progress log

[繁體中文](PROGRESS.zh-TW.md)

Division of work: Claude (Opus) writes specs, reviews and verifies; pi with Qwen3.8-27B (local LM
Studio) implements.
Supervised repo: `D:\Labs\forgekit` (read only; its code is never modified, and `git status` was
checked clean after every step).

## Current state

- The original five steps are done, and so are everything added after them: grouping switch, git
  diff, themes, i18n, multiple agents (pi adapter, file watcher), notifications, scope check,
  timeline replay, large-repo performance, the demo video, and then the remaining ideas from
  `NOTES.md`: open in VS Code, dependency roads, the risk-ordered review list, and box-select
  task assignment; then uncommitted diffs and the optional autostart with Claude Code sessions.
- Tests: 99 at the root (`npm test`) and 90 in the front end (`cd web && npm test`), all passing.
- Every feature was checked in the browser. Zone blocking, including shell writes, was verified
  with the real Claude hook and a real pi session.
- Demo video: `demo/agent-skyline-demo.mp4` (3:55, git-ignored; to re-record, see `demo/README.md`).

| Commit | Contents |
|---|---|
| `ddafe43` | Agent Skyline itself: hooks, zones, server, 3D city, grouping, git diff, themes, i18n, file watcher |
| `3941b6f` | pi adapter; shell writes into locked zones are blocked |
| `366e442` | Alerts, desktop notifications, scope check |
| `307b701` | Timeline replay |
| `585e936` | Performance at 20,000 files |
| `2233a9f` | Demo video; brighter night city |
| `c191032` | Notes and progress log English-first |
| `927a4e1` | Open in VS Code; camera controls in the legend |
| `3df1a7c` | File watcher no longer logs reads as writes |
| `3794324` | Dependency roads |
| `72f53d8` | Risk-ordered review list; branch dependencies while comparing |
| `57b5094` | Box-select task assignment |
| `ed7ade6` | Uncommitted changes and their diffs |
| `2abbe8f` | Optional autostart with a Claude Code session |

## How to use it

1. The hooks are installed in `D:\Labs\forgekit\.claude\settings.local.json` (excluded by
   forgekit's .gitignore). Delete that file to stop watching. For other repos, run
   `node cli/install-hooks.mjs`.
2. Start the server and open http://127.0.0.1:4477:
   ```
   node D:\Labs\game-view-ideas\agent-skyline\server\server.mjs --repo D:\Labs\forgekit
   ```
3. Work in forgekit with Claude Code or pi (with `adapters/pi/agent-skyline.js` loaded); the city shows
   reads and writes live. Text summary: `node cli/report.mjs`.

| Action | How |
|---|---|
| Pan / zoom / rotate | Left drag / wheel / right drag; double-click a building to fly to it |
| File details | Click a building; the side panel shows lines, read/write counts, dependencies, the diff when comparing, and an Open in VS Code link |
| Review / assign a task | The list icon / the select icon in the toolbar |
| Locked zones / allowed scope | The lock / flag in the toolbar, then click blocks to toggle |
| Grouping, branch comparison | The drop-downs in the middle and right of the toolbar |
| Replay | The timeline at the bottom |
| Try it without hooks | `node cli/simulate.mjs --repo D:\Labs\forgekit --file <temp>\events.jsonl`, and start the server with `AGENT_SKYLINE_EVENTS` pointing at the same file |

Colors are explained in the legend at the bottom right.

## Steps

| Step | Status | Spec | Notes |
|---|---|---|---|
| 1 Event log | ✅ | `specs/01-event-log.md` | pi did it in one pass; I added the `CLAUDE_PROJECT_DIR` base (decision 3) |
| 2 Zones | ✅ | `specs/02-zones.md` | Split into three batches; I closed a `..` path bypass (decision 8) |
| 3 Server | ✅ | `specs/03-server.md` | Three batches; I fixed 2 tail bugs and 1 wrong test assumption (decisions 10, 11); **incident, see below** |
| 4 3D city | ✅ | `specs/04-web-city.md` | Three batches; I tuned colors, heights and ground (decision 12) |
| 5 Live events, agent markers, zone UI | ✅ | `specs/05-live.md` | pi did most of Part A; the model was unloaded, so I finished the App wiring; I wrote Parts B and C (decisions 14–16) |

## Decisions

1. **pi was not restarted**: restarting pi in `agent-skyline/` needed `--approve` to trust the folder
   automatically, which the safety rules block. Instead, the pi started in forgekit was reused,
   with the work area fixed by absolute paths.
2. **Zero npm dependencies for hooks and server**: the hook runs on every tool call, so lighter is
   better, and nothing gets introduced into the supervised repo. Only the front end uses npm
   packages.
3. **Paths are relative to `CLAUDE_PROJECT_DIR`**: the payload's `cwd` changes with `cd`, so the
   same file would otherwise get different relative paths.
4. **A broken zones file blocks all writes (fail closed)**: if zones.json exists but is malformed,
   the user meant to lock something. A missing file means no zones.
5. **Known limit (later closed, see decision 29)**: zones only caught Edit/Write/MultiEdit/
   NotebookEdit. Writes through Bash (such as `echo > file`) got through.
6. **Stable layout**: a building's position depends only on its path and the file list of its
   folder, not on line counts.
7. **The server binds to 127.0.0.1 only**: it can write zone settings, so other machines on the
   LAN must not reach it.
8. **Paths are normalized before matching zones**: `api\..\api\Anvil\x.cs` did not match
   `api/Anvil/**`, which bypassed the zone.
9. **How work is handed out**: at most 2 to 3 files per batch, a new session per batch, files
   written only through tools, reports of at most 10 lines, and an explicit list of what is
   forbidden (see the incident).
10. **Two tail bugs (fixed by me)**: if the server started before the event file existed, the
    first batch of events was skipped; a UTF-8 multi-byte character split across reads was cut
    (Chinese paths came out garbled).
11. **Path traversal test rewritten**: `fetch` normalizes `%2e%2e` before sending, so the request
    never reached the server's check. It now uses `..%2f` and really verifies the 403.
12. **Visual tuning (by me)**: the first version was flat gray with nearly flat buildings. It
    became white buildings on stepped blue blocks, heights ×2.5, a smaller ground, and a hemisphere
    light plus a key light from the left.
13. **Event simulator `cli/simulate.mjs` (by me)**: `--file` is required, so it can never write to
    the real event log.
14. **No double counting on reconnect (fixed by me)**: when EventSource reconnects, the server
    resends the latest 200 events, which doubled read/write counts. Each connection now starts
    from an empty state.
15. **Bigger agent markers**: the spec said radius 0.35, invisible in a 150-wide city at default
    zoom. Now 1.2.
16. **Zone matching shares one implementation**: the front end imports the hook's `lib/glob.mjs`
    rather than copying it, so the locked area shown on screen cannot differ from what the hook
    blocks.
17. **Test scopes are separate**: root `npm test` runs only `test/*.test.mjs` and no longer picks
    up the vitest files in `web/`; the server's static directory is injectable, so tests no longer
    depend on whether `web/dist` was built.
18. **Redesign: a night city (after your feedback "it has no impact, and I can't tell what the
    buttons do")**:
    - The city is dark by default. Buildings being read or written are colored above 1.0 and glow
      through a bloom post-process (added `@react-three/postprocessing`).
    - Each read or write sends a ring out from the building's base; a blocked write sends a larger
      red shockwave (`city/Pulses.jsx`, only for events under 5 seconds old, so a reconnect does
      not fire 200 rings at once).
    - Agent markers became glowing inverted cones, with a beam down to the building being worked on.
    - Camera follow (on by default at the time): flies to and zooms in on the latest event; manual
      dragging turns it off.
    - The whole UI went to Traditional Chinese with tooltips on buttons; zone mode got an
      explanation banner (where to click, what locking does, what is locked, one-click unlock); a
      color legend went to the bottom right.
19. **Grouping switch and block names**: blocks show a name and file count (subfolders appear as
    you zoom in). Grouping switches between folder / role / touched this session / diff, and
    buildings fly to their new places when it changes. Groups use internal ids (`code`, `test`…)
    with translated names, so switching language does not rearrange anything.
20. **Bash reads count as reads**: file paths that exist are recognized in commands
    (`commandPaths.js`) and only matched against real buildings, so no files are invented. The
    hook's recorded command length went from 200 to 2000 characters.
21. **git diff**: the server gained `/api/branches`, `/api/diff`, `/api/diff/file` and
    `/api/city?ref=`. All of them read git objects only and never switch the working tree; branch
    names are validated so they cannot be taken as git options. When comparing, the city is built
    from that branch's files, deleted files stay as buildings, buildings are colored by the diff,
    a summary card counts by role, and clicking a building shows its diff.
22. **Theme switch**: night (glowing) / day (saturated, no bloom) / follow the system. Changing
    theme rebuilds the 3D materials; scrollbars and drop-downs follow it through `color-scheme`.
23. **i18n**: Traditional Chinese / English, defaulting to the browser language and saved in
    localStorage. A test ensures both languages have exactly the same string keys.
24. **Events filtered by repo**: all repos share one event file. Events now record their repo
    root and the server only sends its own repo's events, so another project's `README.md` no
    longer lights up this one's.
25. **The activity feed keeps the whole history** (up to 1000 events), scrolls and filters; it
    does not jump when new events arrive while you scroll back. Clicking a file flies the camera
    there and flashes a ring; clicking a command expands the full command and the files it read.
    Double-clicking a building also flies there.
26. **Framing fix**: the reframing formula divided by the current zoom once too often, so the city
    shrank to a dot after switching groups. Added a "fit" button; camera follow is now off by
    default.
27. **Multiple agents, part one: a source field and a file watcher**:
    - Events gained `source` (claude-code, pi, watcher…); old events without it count as
      claude-code. The feed shows "Claude 1", "pi 1", "File watcher", numbered per source. Claude
      gets a cone marker, other agents a diamond, the watcher no marker.
    - The server has a built-in file watcher (`server/watch.mjs`, on by default, `--no-watch` to
      disable). Any write is recorded as a `source: "watcher"` event, so files changed by agents
      without hooks, or by people, are visible, but **it does not know who changed them and cannot
      block anything**.
    - Noise reduction: git-ignored files (bin/, obj/, node_modules/) are skipped, folder changes
      are skipped, and writes already reported by an agent's hook are not recorded twice. No false
      events while forgekit was idle.
    - Part two is the pi adapter (decision 29).
28. **Toolbar redesign**: only the self-explanatory helpers became icons (fit, camera follow,
    zones with a count badge, theme cycling on click, language as a short label). "Group by" and
    "Compare branch" stayed as text, since no icon reads clearly and they are the main actions.
    Emoji were replaced with one set of line SVGs (`ui/Icon.jsx`) that follow the theme. Every icon
    has a Chinese and English tooltip. The toolbar has left (status), middle (grouping) and right
    (compare + tools) sections and fits on one line at normal widths.
29. **pi adapter (`adapters/pi/agent-skyline.js`)**: does the same two things as the Claude hooks
    through pi's extension API: `tool_call` checks zones before a tool runs (it can return
    `{ block: true }`), and `tool_execution_end` records the event afterwards. pi events are first
    converted to the Claude hook format and then go through the same `normalize` and zone logic,
    so both agents follow the same rules.
    - **Bug found by live testing**: pi's `tool_execution_end` carries no arguments, only the
      result; arguments are kept by call id from `tool_execution_start`. A blocked call ends with
      an error result and must not be recorded as a write.
    - **Security gap found by live testing**: a real pi (qwen3.5-9b), after its edit was blocked,
      **wrote into the zone with `echo … > locked/secret.ts`, and it worked**. Claude had the same
      gap. Added `lib/bashTargets.mjs`, which recognizes redirection, `tee`, `sed -i`, `cp`, `mv`,
      `rm`, `touch`, `git checkout --` and PowerShell write commands, and blocks them when the
      target is in a zone. Claude's guard matcher gained `Bash|PowerShell` (forgekit's settings
      and the install template are updated). Writes from inside an interpreter (`python -c`) are
      still not caught; the file watcher records them afterwards.
    - **Retested**: the same pi trying bash into the zone was blocked, the file was unchanged, and
      the event recorded the blocked path.
    - The test used the 9B model (about 10 GB, leaving 9 GB of VRAM, within the 4 to 6 GB rule) in
      a throwaway repo in a temp folder, not forgekit; the model was unloaded afterwards.
30. **Docs are English first**: the README is in English, with `README.zh-TW.md` alongside.
31. **Notifications (blocked or out of scope)**: `lib/alerts.js` turns "blocked" and "scope
    warning" into one alert list. A toast always appears at the top (gone after 7 seconds, click to
    fly there); with the toolbar bell on, desktop notifications are sent too (browser permission is
    requested the first time it is turned on). Only alerts under 15 seconds old notify, so history
    resent on reconnect does not pop up all at once.
32. **Scope check (`lib/scope.js`)**:
    - **Declared**: the flag in the toolbar, then click blocks to add or remove them from the
      allowed scope (stored in `data/scope.json`, `/api/scope`); blocks in scope are tinted light
      green. Writes outside scope raise a warning but are **not blocked** (blocking is what zones
      are for).
    - **Not declared: inferred**, with two rules that can each explain themselves: "write without
      read" (changing an existing file not read this session) and "new area" (after 5 or more
      steps, changing an area not touched at all this session; area = the first two folder
      levels). To be honest: Claude's Edit already requires a read first, so the first rule fires
      less for Claude.
    - **File watcher events are left out of inference**: they have no reads, so every one would
      look like "write without read". Fixed after this noise showed up in testing.
    - Display: buildings with a warning get a yellow cap; the feed gets ⚠ and a "warnings" filter.
33. **Timeline replay**: "Replay this session" at the bottom replays the whole session from the
    start, with play, pause, scrubbing and speeds (1×, 8×, 32×, 120×); every write (amber) and
    block (red) is marked on the timeline. It takes the events before time T and shifts their
    timestamps to "now", so coloring, rings, agent markers and camera follow replay with no
    changes. The toolbar shows "Replaying"; toasts and notifications only consider live events, so
    a replay does not set them off again.
34. **Large-repo performance (results in `docs/performance.md`)**: a synthetic 20,000-file repo
    ran at about 2 fps in Orca's built-in browser, froze the tab, and twice dropped Orca's browser
    connection. Measurement moved to a separate Chrome (`bench/perf.mjs`, Playwright driving the
    installed Chrome with a CPU profile) so Orca was not affected again. Three bottlenecks that
    grew with scale were fixed: the feed draws only 120 rows and is memoized, 1,841 blocks became
    one InstancedMesh, and building tints check only candidates. Same Chrome, before and after:
    main thread busy 44% → 9%, first load 2,054 → 133 ms, memory 79 → 36 MB; replay at 8× still
    runs at 61 fps.
35. **Demo video (`demo/`)**: Remotion was considered (it renders frames from React, which suits
    animated compositions but cannot film a real app with live streaming and WebGL animation).
    Instead, **the real running app is recorded**: Playwright drives Chrome, frames come from the
    CDP screencast (about 60 fps at 1080p) and are written to ffmpeg at a constant 30 fps; title
    cards and bilingual captions are HTML/CSS laid over the page; the story's events are written
    into a separate event file the way the hooks would. The App gained a bridge that exists only
    with `?demo`, so the script can find buildings on screen. Take one was too dark, the action
    happened in too small an area, the 20,000-file section had too many warnings, and the cursor
    showed over title cards; take two (3:10) fixes these. The App itself improved along the way:
    a brighter night theme, and no names on blocks that are too small.
36. **Open in VS Code**: the city now carries the absolute repo path, and the detail panel links
    to `vscode://file/<path>:1`. Only for files in the working tree; a file that exists only on a
    compared branch has nothing to open. The legend also lists the mouse controls (right drag
    rotates), since nothing on screen said so.
37. **File watcher bug: reads logged as writes**: while building dependency roads, reading every
    source file made the watcher log about 500 "writes" in forgekit, which was clean. On
    Windows, `fs.watch` also fires on reads (libuv asks for last-access changes). A notification
    now counts only when the file's mtime or size changed, or, the first time a file is seen,
    when its mtime is as new as the notification. A regression test fails on the old code. Two
    earlier bursts in the event log had the same cause; 818 such events whose file had not been
    modified since were removed from `data/events.jsonl` (backup kept as
    `events.jsonl.bak-before-prune`). Decision 27 said "no false events while idle", which was
    true only because nothing was reading.
38. **Dependency roads (`server/deps.mjs`, `/api/deps`)**: no parser and no CodeGraph index
    (forgekit is not indexed, and indexing is the user's call). JS/TS: relative imports and
    tsconfig `paths` aliases, resolved against the repo's file list. C#: a file uses a type when
    it names it and the type's namespace is visible to it (own namespace and parents, `using`,
    `global using`), with comments and strings stripped. forgekit: 459 edges in 21 ms. Only the
    selected building's roads are drawn, since the whole graph is a hairball; violet = uses,
    pink = used by, green = tests.
39. **Review list ordered by risk (`lib/risk.js`, `/api/churn`)**: changed files (the compared
    branch's diff, or this session's writes), each scored from signals it can explain: warning,
    code no test uses, commits in the last 90 days, dependents, change size, a deleted file still
    in use. Tests, docs and assets are discounted. The first live check found a bug: while
    comparing, "no tests" was judged from the working tree, which did not have the branch's new
    tests. Dependencies now come from the compared branch (`/api/deps?ref=`, read from git
    objects in one `cat-file` process).
40. **Box-select task assignment**: a select tool frees the left mouse button from panning
    (right-drag rotation and wheel zoom keep working); drag a box or click buildings to pick
    files. The task panel copies "task + these files as the scope" for pasting into Claude Code,
    or saves the files as the declared task scope so the scope check warns about anything else.
    It cannot start Claude Code itself: a browser page has no way in, and launching agents from
    the server would be a much bigger trust step. The drag state lives in a ref, because pointer
    events can arrive faster than React re-renders (the first version dropped the box).
41. **Uncommitted diffs (`/api/working`, `/api/working/file`)**: without comparing a branch, the
    detail panel showed no diff at all, so the review list could say what changed but not how.
    The server now lists what differs from HEAD (staged or not, untracked files as all-added) and
    serves one file's diff, only for paths that really changed, so the endpoint cannot be used to
    read arbitrary files. The list is refetched shortly after every reported write. The review
    list in live mode covers every uncommitted change plus this session's writes, so a person's
    edits show up too; that is on purpose, since what gets committed is what needs review.
42. **Optional autostart (`hooks/session-start.mjs`, `install-hooks --autostart [--open]`)**:
    from the notes' "already there when needed". Off by default, as asked. The hook probes
    `/api/health` on ports 4477–4486: a server for this repo is reused, one for another repo is
    skipped, the first free port gets a new detached server. `--open` opens the browser only when
    a server was started, or every session would add a tab. Started servers record their PID;
    `cli/stop-server.mjs` stops them by PID only after checking the port still answers as that
    PID (PIDs get reused), never by name. The test runs the real hook on random high ports and
    stops what it started. forgekit's settings were not changed: turning it on is the user's call.
43. **Dependency roads do not need CodeGraph**: asked whether CodeGraph is a dependency. It is
    not: `server/deps.mjs` reads the sources itself (decision 38), so any repo works without an
    index.
44. **Demo video take 3/4 (3:55)**: new scenes for dependency roads, the review list with an
    uncommitted diff, and box-select task assignment; the architecture card mentions autostart.
    The recording now runs against a throwaway clone of forgekit, and the story's edits are made
    for real there (`EDITS` in `record.mjs`), so the diffs on screen are real; forgekit itself is
    untouched. Take 3 box-selected at full-city zoom and caught 15 files from three folders;
    take 4 flies in first and catches the Extensions folder (8 files).
45. **Zoom toward the cursor**: zooming centered on the screen pushed an edge building off
    screen, which looked like the wheel did nothing. `zoomToCursor`, and about 8% per notch. A
    separate report of the wheel not zooming at all until a reload could not be reproduced.
46. **Time ranges instead of an ever-growing "session"**: the log is never cleared, so "This
    session", the replay, the review list and the scope inference were really "everything",
    growing by the day and making "new area" warnings less and less meaningful. Sessions are now
    split by two quiet hours (`lib/sessions.js`), and the city shows the latest one by default;
    a picker offers today, a past session (closed, with a "Past work" badge, since live events are
    not shown) or everything. The raw events stay in the page and a range change re-folds them;
    the log on disk is untouched.
47. **"Done" alerts, conflicts, agent filter**: Claude Code's Stop hook and pi's `agent_end`
    become "stop" events; each raises an alert with what that turn changed (files, warnings,
    blocks), and clicking it opens the review list. Two different agents writing one file within
    ten minutes is a conflict warning, in the same shape as scope warnings so the feed, caps,
    review list and alerts need no new paths. An agent picker narrows the view to one agent;
    numbering is fixed by the whole time range, and alerts and conflict checks keep watching every
    agent (they read the unfiltered stream). forgekit's `settings.local.json` gained the Stop hook
    (the same file the user authorized for Agent Skyline's hooks).
48. **A real repo (VS Code) found five bugs the synthetic one could not** (details in
    `docs/performance.md`): the server could not open it (`git ls-files` over 1 MB), the camera's
    far plane cut most of the city off, 4,602 district signs as drei `<Html>` made React throw,
    dependency parsing stopped at 8,000 of 14,848 sources, and `/api/deps` was 17 MB. All fixed;
    signs are now one DOM overlay positioned by the scene. Lesson: synthetic data had the right
    size but the wrong shape (short paths, shallow folders, no imports).
49. **Unused imports**: asked "what if an import is superfluous?". C# already ignores an unused
    `using` (an edge needs the type named in the code). JS/TS counted any import, so the names an
    import binds are now checked against the rest of the file (comments and the import lines
    themselves left out); re-exports, side-effect imports, `require` and dynamic `import()`
    always count. An unused import stays a road, since it still loads at run time, but is drawn
    grey and dashed, tagged in the panel, and is a review reason. The real-repo check found one
    true case in forgekit (`Input` in sign-up-card.tsx) and one false road that had been there
    all along: a commented-out import line. Imports inside comments now make no road at all.
    Also: the event stream now sends a line at once, so a repo with no events yet no longer shows
    "offline" for the first 15 seconds.

## ⚠️ Incident: pi killed every Node process (step 3 Part C)

- **What happened**: pi started the server itself for a manual test, and at the end ran
  `taskkill //F //IM node.exe`, force-killing **every** Node process on this machine.
- **Impact**:
  - pi killed itself (it is a Node program). I restarted it.
  - Claude Code's codegraph MCP disconnected. Restarting Claude Code restores it.
  - Any other Node programs running at the time (dev servers and so on) were killed too.
  - pi's manual test sent a PUT to the real server, writing `server/**` into `data/zones.json`. I
    deleted that file.
  - LM Studio was not affected.
- **Prevention**: every handoff since includes these rules: never kill processes by name, never
  start long-running programs, never write to `data/`. It has not happened again. When I stop a
  server, I do it by PID and only for servers I started.
- **Lesson**: pi has no sandbox, and its bash tool can do anything. Handoff rules must spell out
  what is forbidden, not only what to do.

## How pi did

- Step 1: done in one pass, with a test for every line of the spec and its assumptions listed
  where the spec was ambiguous. Good quality.
- Step 2, first try: 7 files in one batch. Qwen drafted all the code in its thinking (61K
  characters), hit the 16K single-output limit, got cut off, and wrote no files.
- Step 2 in three small batches: thinking went 17K → 10K → 2K characters, and all three passed
  first time.
- Step 3: good code, but tail missed two edge cases, one test assumption was wrong, and the manual
  test caused the incident.
- Step 4: Part B (the R3F camera) got stuck reasoning about effect order for over 10 minutes, then
  finished. 3D and React details are clearly harder for a 27B model than plain Node logic.
- Step 5 Part A: good activity logic and tests; the model was unloaded halfway.
- Overall: pi is fast and good at small, clearly specified pure-logic work; parts that need design
  judgment or visual checking go faster when I take them over.
