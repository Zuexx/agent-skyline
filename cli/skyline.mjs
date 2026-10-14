#!/usr/bin/env node
// `skyline`: the one command to remember. Run it inside any git repo, or any folder.
//
//   skyline [<dir>] [--port <n>] [--no-open]   connect this repo and open its city
//   skyline off [<dir>] [--port <n>]            disconnect this repo and stop its servers
//   skyline status                              list running cities
//
// `skyline` connects Claude Code to the repo (hooks in .claude/settings.local.json, merged with
// anything already there, and git-ignored), starts a server for it (or reuses the running one) and
// opens the city. Running it again is safe. The first run builds the UI.
// Install once with `npm link` in the Agent Skyline folder.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServer, listServers, openBrowser, probe } from "../lib/autostart.mjs";
import { disconnectRepo } from "../lib/disconnect.mjs";
import { resolveServersDir } from "../lib/paths.mjs";
import { connectRepoHooks, ensureGitignored, projectRoot, SETTINGS_REL } from "../lib/repoSetup.mjs";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const USAGE = `usage:
  skyline [<dir>] [--port <n>] [--no-open]   connect this repo and open its city
  skyline off [<dir>] [--port <n>]            disconnect this repo and stop its servers
  skyline status                              list running cities`;

function die(message) {
  console.error(message);
  process.exit(1);
}

// The git work tree containing `dir`; outside git, `dir` itself (its city has no branch views).
function findRepo(dir) {
  const abs = path.resolve(dir ?? ".");
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) die(`${abs} is not a folder`);
  return projectRoot(abs);
}

function buildWebOnce() {
  if (existsSync(path.join(webDir, "dist", "index.html"))) return;
  console.log("First run: building the UI (once, about a minute)...");
  // npm is npm.cmd on Windows, which needs a shell; the arguments are fixed strings.
  // windowsHide: harmless with inherited stdio, and keeps the "every spawn hides" rule exception-free.
  for (const args of [["install"], ["run", "build"]]) {
    const r = spawnSync("npm", args, { cwd: webDir, stdio: "inherit", shell: process.platform === "win32", windowsHide: true });
    if (r.status !== 0) die(`\`npm ${args.join(" ")}\` failed in ${webDir}`);
  }
}

async function start(dir, { port, open }) {
  const repo = findRepo(dir);
  buildWebOnce();

  // The hooks report to this folder, the one the server below serves. They only load for a session
  // started in this folder itself (see connectRepoHooks).
  const hooks = await connectRepoHooks(repo, { port });
  const ignored = await ensureGitignored(repo);
  const server = await ensureServer({ repo, basePort: port ?? 4477, serversDir: resolveServersDir() });
  if (!server) die(`ports ${port ?? 4477}-${(port ?? 4477) + 9} are all taken; try --port <n>`);
  if (open) openBrowser(server.url);

  console.log(`${repo}`);
  console.log(`  city    ${server.url}${server.started ? "" : " (already running)"}`);
  if (hooks.changed) {
    console.log(`  hooks   added to ${SETTINGS_REL}`);
    console.log(`          start a NEW Claude Code session here to connect it (already open ones won't see the hooks)`);
  } else {
    console.log(`  hooks   already connected`);
  }
  if (ignored) console.log(`  .gitignore   added ${SETTINGS_REL}`);
  console.log(`  From now on, a Claude Code session here starts the city by itself. \`skyline off\` undoes this.`);
}

async function off(dir, { port }) {
  const repo = findRepo(dir);
  const { hooks, subHooks, ignore, servers, leftovers } = await disconnectRepo({ repo, serversDir: resolveServersDir(), basePort: port ?? 4477 });
  console.log(hooks.changed ? `hooks removed from ${hooks.file}` : `no Agent Skyline hooks in ${hooks.file}`);
  for (const h of subHooks) {
    if (h.error) console.error(`could not edit ${h.file}: ${h.error}`);
    else console.log(`hooks removed from ${h.file}`);
  }
  if (ignore) console.log(`.gitignore: removed the ${SETTINGS_REL} line skyline added`);
  let unfinished = subHooks.some((h) => h.error);
  for (const s of servers) {
    if (s.result === "stopped") console.log(`stopped the city on port ${s.port} (pid ${s.pid})`);
    else if (s.result !== "gone") {
      unfinished = true;
      console.error(s.result);
    }
  }
  // Files skyline never writes: listed, not edited (they may be shared, or hold the user's own setup).
  if (leftovers.length) {
    unfinished = true;
    console.log("\nAgent Skyline hooks are still configured here; skyline did not write these files, so it leaves them to you:");
    for (const l of leftovers) console.log(`  ${l.file}  (${l.events.join(", ")})`);
    console.log('  Open each file and delete the entries under "hooks" whose command runs hooks/guard.mjs,');
    console.log("  hooks/log-event.mjs or hooks/session-start.mjs (drop an event list once it is empty).");
  }
  // Claude Code keeps the hooks it loaded at startup; the SessionStart hook checks the settings
  // files itself, but the other hooks keep running until the session is restarted.
  console.log("\nClaude Code sessions already open here keep their hooks until you restart them: close and reopen them.");
  if (unfinished) process.exitCode = 1;
}

async function status() {
  const records = listServers(resolveServersDir());
  let any = false;
  for (const r of records) {
    const p = await probe(r.port);
    if (p.health?.pid !== r.pid) continue;
    any = true;
    console.log(`http://127.0.0.1:${r.port}  ${r.repo}`);
  }
  if (!any) console.log("no cities running");
}

const args = process.argv.slice(2);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? Number(args[portAt + 1]) : null;
if (port != null && !(Number.isInteger(port) && port > 0)) die(USAGE);
const positional = args.filter((a, i) => !a.startsWith("--") && !(portAt >= 0 && i === portAt + 1));
const unknown = args.filter((a) => a.startsWith("-") && !["--port", "--no-open"].includes(a));
if (args.includes("--help") || args.includes("-h")) positional.unshift("help");
else if (unknown.length) die(USAGE);

try {
  if (positional[0] === "off") await off(positional[1], { port });
  else if (positional[0] === "status") await status();
  else if (positional[0] === "help") console.log(USAGE);
  else await start(positional[0], { port, open: !args.includes("--no-open") });
} catch (err) {
  die(err?.message ?? String(err));
}
