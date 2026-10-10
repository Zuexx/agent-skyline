# Step 2: Locked zones

Goal: a `PreToolUse` hook that blocks Claude Code from editing files inside "locked" zones,
and records each block in the same event log as step 1.

## Constraints

Same as step 1: Node ES modules, zero npm dependencies, `node:test`, Windows + POSIX, all
files under `agent-skyline/`. Do not modify existing files except where this spec says so.
Existing tests must keep passing.

## Files

```
agent-skyline/
├── lib/glob.mjs          # new: minimal glob matcher, pure
├── lib/zones.mjs         # new: load config + decide, pure except loadZones
├── hooks/guard.mjs       # new: PreToolUse hook entry point
└── test/
    ├── glob.test.mjs
    ├── zones.test.mjs
    └── guard.test.mjs
```

Reuse `normalize` from `lib/normalize.mjs` (signature `normalize(payload, now, root)`) to get
`kind` and repo-relative `paths`. Pass `process.env.CLAUDE_PROJECT_DIR` as `root`, exactly as
`hooks/log-event.mjs` does.

## Config file

Path: env `AGENT_SKYLINE_ZONES` if non-empty, else `agent-skyline/data/zones.json` resolved from the
script location (same technique as `defaultLogFile` in `hooks/log-event.mjs`).

```json
{ "locked": ["api/Anvil/**", "openspec/specs/**", "*.lock"] }
```

Globs are matched against the repo-relative `/`-separated path from `normalize`.

## `lib/glob.mjs`

Export `matchGlob(glob, path)` → boolean. Whole-string match.

- `**` matches any number of path segments, including zero (`a/**` matches `a`, `a/b`, `a/b/c`; `**/x.ts` matches `x.ts` and `a/b/x.ts`).
- `*` matches any characters except `/`.
- `?` matches one character except `/`.
- Everything else is literal (escape regex metacharacters like `.`, `(`, `+`).
- Case-insensitive (Windows repos).

## `lib/zones.mjs`

- `loadZones(file)` → `{ status: "missing" }` if the file does not exist,
  `{ status: "invalid", error }` if it is unreadable, not JSON, or `locked` is not an array of strings,
  otherwise `{ status: "ok", locked: string[] }`.
- `decide(event, zones)` → `{ allow: true }` or `{ allow: false, reason, path, zone }`:
  - Only `kind === "write"` events can be blocked. Everything else is allowed.
  - `zones.status === "missing"` → allow (no zones defined).
  - `zones.status === "invalid"` → **deny** every write, reason
    `agent-skyline: zones.json is invalid (<error>); fix it or delete it`. Fail closed: the user meant
    to lock something.
  - Otherwise deny if any path matches any locked glob. Reason:
    `agent-skyline: <path> is in locked zone "<zone>"`.

## `hooks/guard.mjs`

- Read stdin JSON, `normalize`, `loadZones`, `decide`.
- On deny: print to stdout exactly one JSON object and exit 0:
  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}
  ```
  and append to the event log (same file resolution as `hooks/log-event.mjs`) the normalized
  event with `kind` replaced by `"blocked"` and `detail` set to the reason.
- On allow: print nothing, exit 0, write nothing.
- Invalid JSON on stdin or any unexpected error: print nothing, exit 0, message on stderr.
  (Unparseable input means we cannot know the target; do not block.)

Extract the log-file resolution into `lib/paths.mjs` (`defaultLogFile`, `resolveLogFile()`,
`defaultZonesFile`, `resolveZonesFile()`) and make `hooks/log-event.mjs` and `cli/report.mjs`
import from it, so the three scripts cannot drift. Behavior of those two scripts must not change.

## Tests

- glob: the examples above, a literal `.` not matching any char, `*` not crossing `/`, case-insensitivity.
- zones: `loadZones` for missing / invalid JSON / `locked` not an array / ok; `decide` for read
  (allowed even inside a zone), write inside zone, write outside zone, invalid config denies.
- guard: spawn the hook with `AGENT_SKYLINE_ZONES` and `AGENT_SKYLINE_EVENTS` pointing at temp files and
  `CLAUDE_PROJECT_DIR` set:
  - Edit inside a locked zone → exit 0, stdout parses to the deny object, one `blocked` line in the log.
  - Edit outside → exit 0, empty stdout, log absent.
  - Read inside a zone → exit 0, empty stdout.
  - Invalid stdin → exit 0, empty stdout.

## Done when

`cd agent-skyline && npm test` passes (old and new tests), and no file outside `agent-skyline/` changed.
