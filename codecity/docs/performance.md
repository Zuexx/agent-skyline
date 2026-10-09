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

## Reproduce

```bash
cd codecity/bench && npm install
node make-repo.mjs /tmp/repo20000 20000
CODECITY_EVENTS=/tmp/perf/events.jsonl node ../server/server.mjs --repo /tmp/repo20000 --port 4479 --no-watch
node ../cli/simulate.mjs --repo /tmp/repo20000 --file /tmp/perf/events.jsonl --agents 4 --interval 100 --count 3000
node perf.mjs http://127.0.0.1:4479/ 8            # or: ... 8 replay
```

`perf.mjs` drives the installed Chrome (`channel: "chrome"`); it downloads no browser.
