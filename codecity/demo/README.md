# Demo video

[繁體中文](README.zh-TW.md)

`codecity-demo.mp4` (3:10, 1080p, 30 fps, captions in Traditional Chinese and English, no audio) is
recorded from the **real app**, not mocked up: a script drives CodeCity in Chrome, writes the story's
events into the event log the way the hooks would, and records the screen. Videos are git-ignored;
`poster.jpg` is a still from it.

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

Needs Chrome and ffmpeg. Start two servers on fresh, empty logs, then run the director:

```bash
npm install
mkdir -p /tmp/v/main /tmp/v/big && : > /tmp/v/main/events.jsonl && : > /tmp/v/big/events.jsonl
CODECITY_EVENTS=/tmp/v/main/events.jsonl CODECITY_ZONES=/tmp/v/main/zones.json \
  node ../server/server.mjs --repo D:/Labs/forgekit --port 4490 --no-watch &
node ../bench/make-repo.mjs /tmp/repo20000 20000
CODECITY_EVENTS=/tmp/v/big/events.jsonl CODECITY_ZONES=/tmp/v/big/zones.json \
  node ../server/server.mjs --repo /tmp/repo20000 --port 4491 --no-watch &
node record.mjs --out codecity-demo.mp4 --events /tmp/v/main/events.jsonl --big-events /tmp/v/big/events.jsonl
```

The story uses forgekit's files on `main` and its `fix/api-error-and-jwks-hardening` branch; with
another repo, change the paths in `record.mjs`.
