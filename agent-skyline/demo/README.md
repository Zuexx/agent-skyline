# Demo video

[繁體中文](README.zh-TW.md)

`agent-skyline-demo.mp4` (3:55, 1080p, 30 fps, captions in Traditional Chinese and English, no audio) is
recorded from the **real app**, not mocked up: a script drives Agent Skyline in Chrome, writes the story's
events into the event log the way the hooks would, and records the screen. When the story's agent
edits a file, the script really edits it in a throwaway clone of forgekit, so the uncommitted diffs
on screen are real. Videos are git-ignored; `poster.jpg` is a still from it.

The published version adds a voice-over and is attached to the
[demo release](https://github.com/Zuexx/agent-skyline/releases/tag/demo) as
`agent-skyline-demo.mp4`.

The story: the city, grouping, live activity, dependency roads, locked zones (including a blocked
shell write), the scope check, the review list with uncommitted diffs, branch comparison,
box-select task assignment, replay, themes and languages, 20,000 files, and how it works.

## How it is made

- `record.mjs` — the director. Opens the app with `?demo` (which exposes where buildings are on
  screen), moves a visible cursor, clicks real buttons, injects events, and records.
- `overlay.js` — drawn on top of the page: cursor and click ripples, bilingual captions, title cards.
- `cards.mjs` — the title, problem, architecture and outro cards (HTML).

Frames come from Chrome's screencast (CDP, ~60 fps at 1080p); a clock writes the latest frame to
ffmpeg at a constant 30 fps, so the video runs in real time.

Why not Remotion: Remotion renders frames deterministically from React components, which suits
animated compositions but cannot film a live app that streams events and animates in WebGL.
Recording the real app keeps the demo honest; the cards and captions are HTML/CSS, the same idea
as Remotion without the extra toolchain.

## Re-record

Needs Chrome and ffmpeg. Clone forgekit to a throwaway folder (the script edits files in it), start
two servers on fresh, empty logs, then run the director:

```bash
npm install
git clone D:/Labs/forgekit /tmp/v/forgekit
git -C /tmp/v/forgekit branch fix/api-error-and-jwks-hardening origin/fix/api-error-and-jwks-hardening
mkdir -p /tmp/v/main /tmp/v/big && : > /tmp/v/main/events.jsonl && : > /tmp/v/big/events.jsonl
AGENT_SKYLINE_EVENTS=/tmp/v/main/events.jsonl AGENT_SKYLINE_ZONES=/tmp/v/main/zones.json \
  node ../server/server.mjs --repo /tmp/v/forgekit --port 4490 --no-watch &
node ../bench/make-repo.mjs /tmp/repo20000 20000
AGENT_SKYLINE_EVENTS=/tmp/v/big/events.jsonl AGENT_SKYLINE_ZONES=/tmp/v/big/zones.json \
  node ../server/server.mjs --repo /tmp/repo20000 --port 4491 --no-watch &
node record.mjs --out agent-skyline-demo.mp4 --repo-dir /tmp/v/forgekit \
  --events /tmp/v/main/events.jsonl --big-events /tmp/v/big/events.jsonl
```

Never pass a repo you care about as `--repo-dir`. For another take, `git -C /tmp/v/forgekit restore .`,
empty the event logs, delete `scope.json`, and restart the servers. The story uses forgekit's files
on `main` and its `fix/api-error-and-jwks-hardening` branch; with another repo, change the paths and
`EDITS` in `record.mjs`.
