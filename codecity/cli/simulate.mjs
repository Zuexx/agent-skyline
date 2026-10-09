// Write fake Claude Code events for demos and UI testing, without installing the hooks.
// Usage: node cli/simulate.mjs --repo <path> --file <events.jsonl> [--agents 2] [--interval 700] [--count 200]
//
// --file is required on purpose: the simulator must never append to the real event log.
// Each agent wanders inside one top-level directory: reads a few files, then edits one,
// and occasionally gets a write blocked.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { scanRepo } from "../server/scan.mjs";

function parseArgs(argv) {
  const args = { repo: null, file: null, agents: 2, interval: 700, count: 200 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--repo") (args.repo = v), i++;
    else if (argv[i] === "--file") (args.file = v), i++;
    else if (argv[i] === "--agents") (args.agents = Number(v)), i++;
    else if (argv[i] === "--interval") (args.interval = Number(v)), i++;
    else if (argv[i] === "--count") (args.count = Number(v)), i++;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.repo || !args.file) {
  console.error("usage: node cli/simulate.mjs --repo <path> --file <events.jsonl> [--agents 2] [--interval 700] [--count 200]");
  process.exit(1);
}

const files = scanRepo(args.repo).files.map((f) => f.path);
const byTop = new Map();
for (const p of files) {
  const top = p.includes("/") ? p.slice(0, p.indexOf("/")) : "";
  if (!byTop.has(top)) byTop.set(top, []);
  byTop.get(top).push(p);
}
const areas = [...byTop.values()].filter((list) => list.length >= 5).sort((a, b) => b.length - a.length);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const agents = Array.from({ length: args.agents }, (_, i) => ({
  session: `sim-${i + 1}-${Math.random().toString(16).slice(2, 8)}`,
  area: areas[i % areas.length],
  step: 0,
}));

mkdirSync(path.dirname(path.resolve(args.file)), { recursive: true });

function emit(agent, tool, kind, p, detail = null) {
  const ev = {
    ts: new Date().toISOString(),
    session: agent.session,
    agent: null,
    event: kind === "blocked" ? "PreToolUse" : "PostToolUse",
    tool,
    kind,
    paths: [p],
    detail,
  };
  appendFileSync(args.file, JSON.stringify(ev) + "\n", "utf8");
}

let sent = 0;
const timer = setInterval(() => {
  const agent = agents[sent % agents.length];
  const p = pick(agent.area);
  agent.step++;
  if (agent.step % 9 === 0) emit(agent, "Edit", "blocked", p, `codecity: ${p} is in locked zone (simulated)`);
  else if (agent.step % 4 === 0) emit(agent, "Edit", "write", p);
  else emit(agent, "Read", "read", p);
  // Now and then an agent moves on to another part of the repo.
  if (agent.step % 25 === 0) agent.area = pick(areas);
  if (++sent >= args.count) clearInterval(timer);
}, args.interval);
