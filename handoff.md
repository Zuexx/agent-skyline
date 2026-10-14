# Handoff: verify Agent Skyline on Windows

Written for a Claude Code session running on the user's Windows machine, in the Agent Skyline folder.
Read all of it before acting. Language of the user: Traditional Chinese. Reply to the user in Traditional Chinese.

## Background

Agent Skyline shows Claude Code agent activity as a city in the browser. `skyline` connects a repo: it writes hooks into the repo's `.claude/settings.local.json`, starts a background server on port 4477 (or the next free port), and opens the city.

The user installed it on Windows. Two problems were reported:

1. A console window keeps flashing and closing while agents work. Even after `skyline` was removed, windows still flashed, and the user had to clean settings by hand.
2. Agent activity does not show live in the city.

Fixes were made on macOS. They have not been checked on Windows. Your job is to check them on Windows.

Known fix details, so you know what to look for:

- Every child process started by the background server now passes `windowsHide: true` (`server/git.mjs`, `server/scan.mjs`, `server/watch.mjs`, `lib/repoSetup.mjs`, `lib/autostart.mjs`, `cli/skyline.mjs`).
- Hook commands now carry `--root <repo>` (or `--root-b64 <base64url>` when the path has shell-special characters). Events from a session started in a subfolder were being dropped before this, because the hook recorded the subfolder but the server filters by the repo root.
- `skyline off` stops servers for the repo and its subfolders, cleans subfolder `settings.local.json`, and lists leftover Skyline hooks in other settings files (it does not edit those).

Latest commit that contains all of this: `3e56a12` on `origin/main`. CI on Ubuntu, macOS and Windows with Node 22 and 24 passes on that commit.

## Rules

- Only change the test project described below. Do not modify the real project, and do not modify anything under `~\.claude` or any other user settings file. Read only.
- Do not commit, push, or run `npm link`.
- Do not change source files to make a check pass. If a check fails, report it exactly and stop that check.
- Report each step's real output. Do not guess. Mark anything you could not run as "not run" with the reason.
- The user is not a programmer. Keep the final report short, in plain Traditional Chinese, with the raw output in a code block for each check.

## Steps

### 1. Check the working copy

```powershell
cd <Agent Skyline folder>
git status
```

If there are modified files (lines starting with `M`), stop and report them. Do not pull.

If clean:

```powershell
git pull origin main
git log --oneline -1
```

Report the commit. It should be `3e56a12` or later.

### 2. Run the test suite on Windows

```powershell
npm test
```

Report the counts of tests, pass, fail and skipped. If anything fails, paste the failing test names and the first error lines.

### 3. Prepare the test project

Use `$env:USERPROFILE\skytest`. Create it only if missing.

```powershell
$REPO = "$env:USERPROFILE\skytest"
if (-not (Test-Path $REPO)) { mkdir "$REPO\api" -Force | Out-Null; git -C $REPO init -q; Set-Content "$REPO\api\a.cs" "x" }
```

### 4. Check C2: node and shell

```powershell
where.exe node
node -v
```

Report both outputs. Also report `$env:ComSpec` and the output of `Get-Command bash -ErrorAction SilentlyContinue | Select-Object Source`.

### 5. Check C6: hook start-up time

```powershell
Measure-Command { '{}' | node "<Agent Skyline folder>\hooks\log-event.mjs" } | Select-Object TotalMilliseconds
```

Run it three times and report all three numbers.

### 6. Check C1: does the background server still flash, and does it stop

```powershell
node "<Agent Skyline folder>\cli\skyline.mjs" off $REPO
tasklist /fi "imagename eq node.exe"
```

Report the `tasklist` output. There must be no `server.mjs` process. Then ask the user to watch for windows while you do step 7.

### 7. Check C1 and C4: connect the repo and see whether events arrive

```powershell
node "<Agent Skyline folder>\cli\skyline.mjs" --no-open $REPO
```

Report the full output. It should show a city URL and say hooks were added.

Then ask the user to open a **new** Claude Code session in `$env:USERPROFILE\skytest\api` and ask it to create `b.cs` there. Tell the user clearly that this must be a separate session started in that folder, not this one. Wait for the user to confirm it is done.

After the user confirms, run:

```powershell
Get-Content "<Agent Skyline folder>\data\events.jsonl" -Tail 3
(Invoke-RestMethod http://127.0.0.1:4477/api/health).repoPath
```

Report both outputs. Then answer:

- C4: do the last lines mention `b.cs`? (yes / no)
- C5: does the `root` value in those lines match `repoPath`, ignoring case and slash direction? (yes / no)

### 8. Ask the user about flashing

Ask the user one question: did any console window flash while step 7 ran, and while the second session worked? Record the answer as given (yes / no / not sure).

### 9. Clean up

```powershell
node "<Agent Skyline folder>\cli\skyline.mjs" off $REPO
```

Report the output.

## Final report

Give the user a short Traditional Chinese summary with this list, then the raw output for each item:

- Commit checked out.
- `npm test` counts.
- C2: node and shell result.
- C1: flashing answer from the user, and whether `server.mjs` was gone after `off`.
- C4: yes / no.
- C5: yes / no.
- C6: three numbers.
- Anything not run, and why.

Do not recommend the next phase. The user decides that after reading the report.
