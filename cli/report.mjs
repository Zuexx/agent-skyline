// Summarize the Agent Skyline event log, grouped per session (oldest first).
// Usage: node cli/report.mjs [--repo <dir>] [--file <path>] [--session <id>]

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolveLogFile } from "../lib/paths.mjs";

function parseArgs(argv) {
  const args = { file: null, session: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && i + 1 < argv.length) args.file = argv[++i];
    else if (argv[i] === "--session" && i + 1 < argv.length) args.session = argv[++i];
    else if (argv[i] === "--repo" && i + 1 < argv.length) args.repo = argv[++i];
  }
  return args;
}

// --file wins over AGENT_SKYLINE_EVENTS, which wins over the repo's log (--repo, else the current
// folder's when it has one), which wins over the old shared log.
function resolveReportFile(cliFile, repo) {
  if (typeof cliFile === "string" && cliFile.length > 0) return cliFile;
  if (repo) return resolveLogFile(repo);
  const here = resolveLogFile(process.cwd());
  return existsSync(here) ? here : resolveLogFile();
}

function loadEvents(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null; // missing or unreadable file → caller prints "no events"
  }
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const ev = JSON.parse(line);
      if (ev !== null && typeof ev === "object") events.push(ev);
    } catch {
      // skip lines that fail to parse
    }
  }
  return events;
}

function byCountDescPathAsc(entries) {
  return entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const events = loadEvents(resolveReportFile(args.file, args.repo));
  if (events === null) {
    console.log("no events");
    return;
  }

  const sessions = new Map(); // session id (or null) -> record
  for (const ev of events) {
    const id = typeof ev.session === "string" && ev.session.length > 0 ? ev.session : null;
    if (args.session !== null && id !== args.session) continue;
    let rec = sessions.get(id);
    if (!rec) {
      rec = { id, first: null, last: null, written: new Map(), read: new Map() };
      sessions.set(id, rec);
    }
    const ts = typeof ev.ts === "string" && ev.ts.length > 0 ? ev.ts : null;
    if (ts !== null) {
      if (rec.first === null || ts < rec.first) rec.first = ts;
      if (rec.last === null || ts > rec.last) rec.last = ts;
    }
    const paths = Array.isArray(ev.paths) ? ev.paths : [];
    for (const p of paths) {
      if (typeof p !== "string" || p.length === 0) continue;
      const map = ev.kind === "write" ? rec.written : ev.kind === "read" ? rec.read : null;
      if (map) map.set(p, (map.get(p) ?? 0) + 1);
    }
  }

  const ordered = [...sessions.values()].sort((a, b) => {
    const af = a.first ?? "";
    const bf = b.first ?? "";
    return af < bf ? -1 : af > bf ? 1 : 0;
  });

  for (const rec of ordered) {
    console.log(`session ${rec.id ?? "(none)"}`);
    console.log(`first: ${rec.first ?? "-"}`);
    console.log(`last:  ${rec.last ?? "-"}`);
    console.log("written:");
    for (const [p, n] of byCountDescPathAsc([...rec.written.entries()])) {
      console.log(`  ${p} (${n})`);
    }
    console.log("read:");
    for (const [p, n] of byCountDescPathAsc([...rec.read.entries()])) {
      console.log(`  ${p} (${n})`);
    }
  }
}

main();
