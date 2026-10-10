# Agent Skyline

[繁體中文](README.zh-TW.md)

**Watch your AI coding agent work, and stop it before it writes where it shouldn't.**

Agent Skyline draws your git repository as a 3D city — folders are districts, files are buildings,
building height is line count — and lights it up as Claude Code (or pi) reads and writes files.

[![Agent Skyline demo](agent-skyline/demo/poster.jpg)](https://github.com/Zuexx/agent-skyline/releases/download/demo/agent-skyline-demo.mp4)

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
cd agent-skyline/agent-skyline          # the tool lives in a folder with the same name

cd web && npm install && npm run build  # 1. build the UI (once)
cd ..
node server/server.mjs --repo D:/path/to/your/repo   # 2. start the server
```

3. Open http://127.0.0.1:4477 — you'll see your repo as a city.

4. Connect Claude Code so the city sees what it does and can block writes:

   ```bash
   node cli/install-hooks.mjs D:/path/to/your/repo --write
   ```

   This writes `<your repo>/.claude/settings.local.json`; add that path to your repo's
   `.gitignore`. Start a **new** Claude Code session to load the hooks; delete the file to remove
   them.

No agent handy? `node cli/simulate.mjs` plays a fake session — see the full guide.

## Learn more

| Document | What's in it |
|---|---|
| [`agent-skyline/README.md`](agent-skyline/README.md) | Full guide: pi, auto-start with each session, locked zones, every UI feature, tests |
| [`agent-skyline/NOTES.md`](agent-skyline/NOTES.md) | The idea, and why it is shaped this way |
| [`agent-skyline/PROGRESS.md`](agent-skyline/PROGRESS.md) | How it was built: every decision, and one incident |

Formerly called CodeCity; renamed because several other projects already use that name.

## License

MIT — see [`LICENSE`](LICENSE).
