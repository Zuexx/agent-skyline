# Performance

[繁體中文](performance.zh-TW.md)

Measured on 2026-10-09: Windows 11, RTX 4090, Chrome (headless, GPU via ANGLE/D3D11), viewport
1600×900, night theme. Repos are synthetic (`bench/make-repo.mjs`): files spread over up to four
folder levels, 1–400 lines each.

## Server

| Files | Folders (districts) | Scan | Layout | `/api/city` JSON |
|---:|---:|---:|---:|---:|
| 518 (forgekit) | 234 | 1.8 s* | 2 ms | 80 KB |
| 5,000 | 1,841 | 258 ms | 10 ms | 545 KB |
| 20,000 | 1,841 | 963 ms | 19 ms | 1.85 MB |

\* The forgekit scan was the first one after boot (cold disk cache); the synthetic repos ran warm.
The scan runs once at start and on rescan; layout is cheap enough to redo in the browser for
every grouping.

## Browser, 20,000 files

Same Chrome, same script (`bench/perf.mjs`), 3,000 events of history replayed on connect,
10 live events per second while measuring.

| | Before | After |
|---|---:|---:|
| Main thread busy | 44% | 9% |
| First load | 2,054 ms | 133 ms |
| JS heap | 79 MB | 36 MB |
| Frames per second | 56 | 61 (display cap) |
| Replay at 8× | — | 61 fps, 14% busy |

In Orca's embedded browser, which has less headroom, the "before" build dropped to about 2 frames
per second and froze the tab.

### What changed

1. **The activity feed rendered its whole history** (up to 1,000 rows) on every update, ten times a
   second. It now renders a window of 120 rows that grows as you scroll, and rows are memoized
   with stable callbacks so unchanged rows are skipped.
2. **Every folder was its own mesh and React element** — 1,841 draw calls and 1,841 elements to
   reconcile on each update. Folders are now one `InstancedMesh`; clicks resolve the folder from
   the instance id.
3. **Building tints were re-evaluated for all 20,000 buildings** four times a second. Only
   candidates are visited now: files with activity, files in the compared diff, and buildings not
   currently in the base color.

## A real repo: VS Code (20,323 files)

Measured on 2026-10-09 against a shallow clone of `microsoft/vscode` (20,323 files, 14,848 JS/TS
sources, 4,602 folders). The synthetic repo has the same file count, but a real one has long
paths, deep folders and real imports, and that found five problems the synthetic one could not:

| Problem | Effect | Fix |
|---|---|---|
| `git ls-files` output over 1 MB (long paths) | The server could not open the repo at all (`ENOBUFS`) | `maxBuffer` raised, as in `git.mjs` |
| City 1,880 units deep, camera ~2,300 away | Most of the city was cut off by the camera's default far plane (2,000) | Far plane sized from the city |
| 4,602 districts, signs as drei `<Html>` | Zooming mounted and unmounted hundreds of React roots at once; React threw (`removeChild`) | Signs are one DOM overlay, positioned by the scene each frame |
| Dependency parsing capped at 8,000 files | Stopped halfway through the alphabet: most of `src/vs` had no roads | Cap raised to 40,000 (parsing is ~0.12 ms per file) |
| 139,456 dependency edges as path pairs | `/api/deps` was 17 MB of JSON | Paths sent once, edges as index pairs: 2.4 MB |

Server, after the fixes (second run; see "First run" below):

| Step | Time |
|---|---:|
| Scan (file list + line counts) | 1.7–1.9 s |
| Layout | 47 ms |
| Dependencies (14,848 sources, 139,456 edges) | 1.9 s |
| Churn, last 90 days | 0.3 s |
| Uncommitted changes | 0.7 s |
| `/api/city` / `/api/deps` | 3.2 MB / 2.4 MB |

Browser, same method as above (3,000 events of history, 10 live events a second): first load
162–171 ms, main thread about 85% idle, replay at 8× just as smooth, 37–42 MB JS heap. Selecting a
building and drawing its roads takes about 50 ms.

**First run.** The very first scan after the clone took 146 s, the second 1.9 s. Every file is
opened once to count lines, and Windows Defender's real-time protection (on) scans each file on
first open; that is the likely cause, not proven. The first churn took 44 s because the clone was
partial (`--filter=blob:none`) and rename detection fetched file contents over the network; churn
now runs with `--no-renames`, which never needs contents.

**Still open.** With deep folder trees the layout leaves wide empty margins between districts, so
at overview VS Code's buildings look small and sparse. Readable when zoomed in, but worth a better
packing later.

## Reproduce

```bash
cd agent-skyline/bench && npm install
node make-repo.mjs /tmp/repo20000 20000
AGENT_SKYLINE_EVENTS=/tmp/perf/events.jsonl node ../server/server.mjs --repo /tmp/repo20000 --port 4479 --no-watch
node ../cli/simulate.mjs --repo /tmp/repo20000 --file /tmp/perf/events.jsonl --agents 4 --interval 100 --count 3000
node perf.mjs http://127.0.0.1:4479/ 8            # or: ... 8 replay
```

`perf.mjs` drives the installed Chrome (`channel: "chrome"`); it downloads no browser.
