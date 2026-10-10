# Agent Skyline: full guide

[繁體中文](guide.zh-TW.md) · [Back to the front page](../README.md)

Agent Skyline draws a git repository as a 3D city — folders are districts, files are buildings,
building height is line count — and uses it to **supervise AI coding agents**:

- see live which files an agent reads and writes;
- lock folders so that writes into them are **blocked before they happen**;
- compare a branch with `main` and see at a glance what changed, and whether tests came with it;
- review changes riskiest first, follow a file's dependency roads, and pick files with a box to
  hand an agent a task scoped to them.

It works with **Claude Code** (hooks) and **pi** (an extension). Anything else — other agents, or
people — is still seen through a file watcher, just without knowing who made the change.

More context: [`NOTES.md`](NOTES.md) (the idea and why it is shaped like this), [`PROGRESS.md`](PROGRESS.md) (how it was
built, every decision and the one incident), [`specs/`](../specs/) (the step-by-step specs).

## Quick start

Requires Node 22+ and git. Run these from the repository root.

```bash
cd web && npm install && npm run build                  # build the UI once
cd .. && node server/server.mjs --repo D:/path/to/repo  # start the server
```

Open http://127.0.0.1:4477. The server only listens on 127.0.0.1.

Options: `--port <n>`, `--no-watch` (turn off the file watcher).

### Which folders it can watch

Any folder that is a **git repository**, code or not: notes, docs, a writing project, data files
all work. Every file is a building and its height is its line count (binary files are flat).
Files git ignores (`.gitignore`) are left out; new files show up before anyone runs `git add`.
A folder that is not a repository yet only needs `git init` (no commit required). Git is what
gives the city its file list, branch comparison, uncommitted diffs and history. Dependency roads
exist for JS/TS, Python, Go, Java/Kotlin/Scala, C#, C/C++/Objective-C, Rust, PHP, Ruby and Swift
(see [Dependency roads](#dependency-roads)).

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

## Dependency roads

Roads come from simple, explainable rules per language, not from a compiler: nothing to install,
and the same rules work on a branch read straight from git. They answer "who uses this file",
and can occasionally add a road a compiler would not (a name in a comment, two types with the
same name).

| Language | What makes a road |
|---|---|
| JS/TS | Relative imports and tsconfig `paths` aliases; an import whose names are never used is marked |
| Python | `import a.b` / `from a.b import c` / relative `from .x import y`, from any source root (`src/` layouts work) |
| Go | Imports of the repo's own packages (by the `go.mod` module) to the files declaring the names used; files of one package by the names they share, so `x_test.go` finds `x.go` |
| Java, Kotlin, Scala | Types named from the same package, single or wildcard imports, static imports; the three languages see each other |
| C# | Types named from visible namespaces: own and parent namespaces, `using`, `global using` |
| C, C++, Objective-C | `#include "…"` next to the file, or the repo file ending in that path |
| Rust | `mod x;`, and `crate::` / `self::` / `super::` / workspace-crate paths to the deepest module file |
| PHP | Classes named from the same namespace, `use` (renamed and grouped), fully qualified names, `require`/`include` |
| Ruby | `require_relative`, `require` by path, and classes/modules named (for Rails-style autoloading) |
| Swift | Types named, across all Swift files of the repo |

Methods called on a value (`user.save()`) are not followed: which file declares `save` depends on
the value's type. The type itself usually leads to the same file.

Another language is one more module in `server/deps/` (`server/deps/common.mjs` describes its
shape and holds the shared helpers) and one line in `LANGUAGES` in `server/deps.mjs`. Test files
are recognized by name in `web/src/lib/views.js` (`roleOf`), which is what makes a road green.

## In the UI

| Feature | How |
|---|---|
| Group by | Folders / Role (code, tests, specs, docs…) / This session / Diff. Buildings fly to their new places |
| Time range | Next to the live status: the **latest session** by default (two quiet hours start a new one), today, a past session, or everything. The event log keeps everything; the city, the timeline, "This session", the review list and the scope inference all follow the chosen range |
| Activity | Bottom left; filter, scroll back; click a file to fly there, click a command to expand it |
| Compare | Pick a branch to compare with main; the city is colored by git diff; click a building for its diff |
| File details | Click a building: lines, activity, its **uncommitted diff** (or the branch's diff when comparing), **Open in VS Code** |
| Dependency roads | Clicking a building also draws arcs: violet to what it uses, pink from what uses it, green from its tests (see [Dependency roads](#dependency-roads); the panel lists them). A JS/TS import whose names are never used is a grey dashed road, tagged "unused" in the panel and counted in the review list |
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
