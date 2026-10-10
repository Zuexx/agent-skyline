# Step 1: Event log

Goal: record every file Claude Code reads or writes, as one JSON line per tool call, so
later steps (zones, city) can replay and display them. Text only, no UI.

## Constraints

- Node.js, ES modules (`.mjs`), **zero npm dependencies**. Node built-ins only.
- Tests use `node:test` and `node:assert/strict`. Run with `npm test`.
- Must work on Windows and POSIX. Never assume `/` or `\` in input paths.
- All files live under `agent-skyline/`. Do not touch anything outside it.

## Files to create

```
agent-skyline/
├── package.json          # { "type": "module", "scripts": { "test": "node --test" } }
├── lib/normalize.mjs     # pure function, no I/O
├── hooks/log-event.mjs   # Claude Code hook entry point
├── cli/report.mjs        # summary of the log
└── test/
    ├── normalize.test.mjs
    ├── log-event.test.mjs
    └── report.test.mjs
```

## Input: Claude Code hook payload (JSON on stdin)

```json
{
  "session_id": "abc123",
  "cwd": "D:\\Labs\\forgekit",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": { "file_path": "D:\\Labs\\forgekit\\api\\Anvil\\Data\\UnitOfWork.cs" },
  "agent_id": "optional, present only inside subagents"
}
```

Other fields may exist; ignore them.

## `lib/normalize.mjs`

Export `normalize(payload, now = new Date())` returning:

```json
{
  "ts": "2026-10-09T08:00:00.000Z",
  "session": "abc123",
  "agent": null,
  "event": "PostToolUse",
  "tool": "Edit",
  "kind": "write",
  "paths": ["api/Anvil/Data/UnitOfWork.cs"],
  "detail": null
}
```

Tool → kind, paths, detail:

| tool_name | kind | paths from | detail |
|---|---|---|---|
| `Read` | `read` | `tool_input.file_path` | null |
| `Edit`, `Write`, `MultiEdit` | `write` | `tool_input.file_path` | null |
| `NotebookEdit` | `write` | `tool_input.notebook_path` | null |
| `Glob`, `Grep` | `search` | `tool_input.path` if present, else `[]` | `tool_input.pattern` |
| `Bash`, `PowerShell` | `exec` | `[]` | `tool_input.command` |
| anything else | `other` | `[]` | null |

Rules:

- `agent` is `payload.agent_id` or `null`.
- Paths are made relative to `payload.cwd` and use `/` separators.
  `D:\Labs\forgekit\api\x.cs` with cwd `D:\Labs\forgekit` → `api/x.cs`.
  Drive letter / case differences on Windows must not break this (`d:\labs\Forgekit\a.ts` with cwd `D:\Labs\forgekit` → `a.ts`).
- A path outside `cwd` is kept absolute, with `/` separators.
- `detail` is truncated to 200 characters.
- Missing or malformed fields never throw; they produce `null` / `[]` / `"other"`.

## `hooks/log-event.mjs`

- Read all of stdin, `JSON.parse`, `normalize`, append `JSON.stringify(event) + "\n"` to the log file.
- Log file: env `AGENT_SKYLINE_EVENTS` if set, otherwise `agent-skyline/data/events.jsonl`
  resolved from the script's own location (`import.meta.url`), not from the current directory.
- Create the parent directory if missing.
- **Must always exit with code 0 and print nothing to stdout**, even on invalid JSON or a
  write error. A failing hook would disturb the agent being observed. Errors go to stderr only.

## `cli/report.mjs`

`node cli/report.mjs [--file <path>] [--session <id>]`

- Default file: same resolution as the hook.
- Prints, per session (oldest first): session id, first and last `ts`, then
  `written:` and `read:` lists, each file with its count, sorted by count desc then path asc.
- `--session` limits output to one session.
- Missing file → print `no events` and exit 0. Skip lines that fail to parse.

## Tests (must all pass with `npm test`)

- normalize: one test per row of the mapping table; Windows path relative; case-insensitive
  drive; path outside cwd; truncation of a 500-char command; payload `{}` does not throw.
- log-event: spawn the hook with `AGENT_SKYLINE_EVENTS` pointing to a temp file, pipe a payload,
  assert exit code 0, empty stdout, one valid JSON line. Second case: invalid JSON on stdin →
  exit code 0, file unchanged or absent.
- report: write a temp JSONL with two sessions and one broken line; assert output contains
  both sessions in order and correct counts; `--session` filters.

## Done when

`cd agent-skyline && npm test` passes, and no file outside `agent-skyline/` was changed.
