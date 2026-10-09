# game-view-ideas

[繁體中文](README.zh-TW.md)

References for presenting structured data as game-like, isometric or 3D scenes — collected to
spark ideas — and one of those ideas built into a working tool.

## Contents

- `waretrack/` — teardown of a video about a 3D warehouse-management app (`NOTES.md` is the summary).
- `codecity/` — draws a repo as a 3D city to supervise AI coding agents live: what they read and
  write, locked zones that block writes, and branch comparison by git diff. Start with
  `codecity/README.md`.

## Conventions

- Each reference case gets a folder with `NOTES.md`, `frames/` (screenshots) and `video.info.json`.
- Video files (`*.mp4`, `*.webm`, `*.mkv`) are git-ignored and stay local.
- CodeCity's `node_modules/`, `web/dist/` and live data in `data/` (event log, locked zones) are not
  versioned either.
- Docs are written in English first, with a Traditional Chinese version next to them (`*.zh-TW.md`).
