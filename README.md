# Agent Skyline

[繁體中文](README.zh-TW.md)

**Watch your AI coding agent work, and stop it before it writes where it shouldn't.**

Agent Skyline draws your git repository as a 3D city — folders are districts, files are buildings,
building height is line count — and lights it up as Claude Code (or pi) reads and writes files.

[![Agent Skyline demo](demo/poster.jpg)](https://github.com/Zuexx/agent-skyline/releases/download/demo/agent-skyline-demo.mp4)

▶ Demo video (about 4 minutes): click the image above, or download it from the
[release page](https://github.com/Zuexx/agent-skyline/releases/tag/demo).

## What it does

- **See it live**: which files the agent reads (blue) and writes (amber), as it happens.
- **Lock folders**: writes into a locked folder are **blocked before they happen** — through
  Edit/Write and through shell commands like `echo … > file`.
- **Review a branch**: compare it with `main`; the city is colored by git diff, and a review list
  puts the riskiest changes first (no tests, many dependents, large change).
- **Hand out work**: drag a box over buildings to turn those files into a task scope for the agent.

It runs on your machine only (the server listens on 127.0.0.1) and works with **Claude Code** and
**pi**. Changes from anyone else still show up through a file watcher.

## Quick start

Requires Node 22+ and git. The watched folder must be a git repository (`git init` is enough).

```bash
git clone https://github.com/Zuexx/agent-skyline.git
cd agent-skyline
npm link        # once: installs the `skyline` command
```

Then, in any git repository (`git init` is enough):

```bash
cd D:/path/to/your/repo
skyline
```

That's it. The city opens in your browser, and Claude Code is connected to the repo: start a
**new** Claude Code session there and you'll see it work. From then on, every Claude Code session
in that repo starts the city by itself. The first run also builds the UI, which takes about a
minute.

| Command | What it does |
|---|---|
| `skyline` | Connect this repo and open its city. Safe to run again. |
| `skyline off` | Disconnect this repo and stop its city |
| `skyline status` | List running cities |

`skyline` writes its hooks into `<repo>/.claude/settings.local.json` (keeping anything else in that
file) and makes sure git ignores that file.

No agent handy? `node cli/simulate.mjs` plays a fake session — see the full guide.

## Learn more

| Document | What's in it |
|---|---|
| [`docs/guide.md`](docs/guide.md) | Full guide: pi, auto-start with each session, locked zones, every UI feature, tests |
| [`docs/NOTES.md`](docs/NOTES.md) | The idea, and why it is shaped this way |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | How it was built: every decision, and one incident |

Formerly called CodeCity; renamed because several other projects already use that name.

## License

MIT — see [`LICENSE`](LICENSE).
