# Agent Skyline

[繁體中文](README.zh-TW.md)

Agent Skyline draws a git repository as a 3D city — folders are districts, files are buildings,
building height is line count — and uses it to **supervise AI coding agents**:

- see live which files an agent reads and writes;
- lock folders so that writes into them are **blocked before they happen**;
- compare a branch with `main` and see at a glance what changed, and whether tests came with it;
- review changes riskiest first, follow a file's dependency roads, and pick files with a box to
  hand an agent a task scoped to them.

It works with **Claude Code** (hooks) and **pi** (an extension). Anything else — other agents, or
people — is still seen through a file watcher, just without knowing who made the change.

More context: `NOTES.md` (the idea and why it is shaped like this), `PROGRESS.md` (how it was
built, every decision and the one incident), `specs/` (the step-by-step specs).

## Quick start

Requires Node 22+ and git.

```bash
cd agent-skyline/web && npm install && npm run build       # build the UI once
cd .. && node server/server.mjs --repo D:/path/to/repo  # start the server
```

Open http://127.0.0.1:4477. The server only listens on 127.0.0.1.

Options: `--port <n>`, `--no-watch` (turn off the file watcher).

### Which folders it can watch

Any folder that is a **git repository**, code or not: notes, docs, a writing project, data files
all work. Every file is a building and its height is its line count (binary files are flat).
Files git ignores (`.gitignore`) are left out; new files show up before anyone runs `git add`.
A folder that is not a repository yet only needs `git init` (no commit required). Git is what
gives the city its file list, branch comparison, uncommitted diffs and history; dependency roads
only exist for JS/TS and C#.

## Connect an agent

### Claude Code

```bash
node cli/install-hooks.mjs D:/path/to/repo            # print the settings to paste
node cli/install-hooks.mjs D:/path/to/repo --write    # write <repo>/.claude/settings.local.json
```

Make sure the target repo git-ignores `.claude/settings.local.json`. Only Claude Code sessions
started **after** that pick up the hooks. Delete the file to stop.

- `hooks/log-event.mjs` (PostToolUse) appends one event per tool call to `data/events.jsonl`.
- `hooks/guard.mjs` (PreToolUse) blocks writes into locked zones — through Edit/Write **and**
  through shell commands.

**Start the city with the session (optional, off by default):**

```bash
node cli/install-hooks.mjs D:/path/to/repo --write --autostart          # start the server
node cli/install-hooks.mjs D:/path/to/repo --write --autostart --open   # …and open the browser
```

This adds a SessionStart hook (`hooks/session-start.mjs`). It reuses an Agent Skyline server that already
serves the repo; otherwise it starts one in the background on the first free port from 4477
(`--port` to change). `--open` opens the browser only when it had to start a server. The hook prints
nothing and never fails the session. Servers it started keep running after the session; list or
stop them by PID with `node cli/stop-server.mjs [<port> | --all]`.

### pi

```bash
pi --extension D:/path/to/agent-skyline/adapters/pi/agent-skyline.js     # one run
```

or import `adapters/pi/agent-skyline.js` from a file in `~/.pi/agent/extensions/` to load it always.
It logs pi's tool calls and blocks writes into locked zones (write, edit and bash), using the same
rules as the Claude Code hooks. Events show up as "pi 1", "pi 2", …

### Anything else

The server watches the repo. Changes no agent reported appear as **File watcher** events:
visible, but not attributed and not blockable. Git-ignored paths (`bin/`, `node_modules/`, …) are
skipped, a change an agent already reported is not logged twice, and a notification without a
content change (on Windows, a plain read fires one) is ignored.

## Locked zones and shell commands

A locked zone blocks writes; reading stays allowed. An agent blocked on Edit was observed retrying
with `echo … > file`, so shell commands are checked too: redirections, `tee`, `sed -i`, `cp`, `mv`,
`rm`, `touch`, `git checkout --`, and the PowerShell equivalents. Writes made inside an interpreter
(`python -c …`, `node -e …`) or a script cannot be seen in advance; the file watcher records them
afterwards.

## In the UI

| Feature | How |
|---|---|
| Group by | Folders / Role (code, tests, specs, docs…) / This session / Diff. Buildings fly to their new places |
| Time range | Next to the live status: the **latest session** by default (two quiet hours start a new one), today, a past session, or everything. The event log keeps everything; the city, the timeline, "This session", the review list and the scope inference all follow the chosen range |
| Activity | Bottom left; filter, scroll back; click a file to fly there, click a command to expand it |
| Compare | Pick a branch to compare with main; the city is colored by git diff; click a building for its diff |
| File details | Click a building: lines, activity, its **uncommitted diff** (or the branch's diff when comparing), **Open in VS Code** |
| Dependency roads | Clicking a building also draws arcs: violet to what it uses, pink from what uses it, green from its tests (JS/TS imports, C# type use; the panel lists them). A JS/TS import whose names are never used is a grey dashed road, tagged "unused" in the panel and counted in the review list |
| Review list | List icon: the compared branch's changes, or everything uncommitted plus this session's writes, riskiest first, with reasons (warnings, no tests, recent churn, many dependents, large change). Tick files off as you go |
| Assign a task | Select icon → drag a box over buildings (or click them). Copy the task with the files as its scope, or save them as the task scope |
| Task scope | Flag icon → click districts; writes outside raise a warning. With nothing declared, the scope is inferred |
| Locked zones | Lock icon → click districts to lock or unlock |
| Alerts | Toasts for blocked and out-of-scope writes; the bell turns on desktop notifications |
| Replay | Bottom: replay the session at 1×–120× |
| Camera | Left drag pans, right drag rotates, wheel zooms. Map icon: whole city. Target icon: follow the latest action. Double-click a building to fly to it |
| Theme / language | Night, day, or system; 繁中 or English |

## Tests

```bash
npm test              # server, hooks, adapters, layout (node:test)
cd web && npm test    # UI logic (vitest)
```

## Try it without an agent

```bash
AGENT_SKYLINE_EVENTS=/tmp/sim/events.jsonl node server/server.mjs --repo D:/path/to/repo --port 4478
node cli/simulate.mjs --repo D:/path/to/repo --file /tmp/sim/events.jsonl
```

The simulator requires `--file`, so it can never write into the real event log.
