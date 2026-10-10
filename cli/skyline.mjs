#!/usr/bin/env node
// `skyline`: the one command to remember. Run it inside any git repo.
//
//   skyline [<dir>] [--port <n>] [--no-open]   connect this repo and open its city
//   skyline off [<dir>]                         disconnect this repo and stop its server
//   skyline status                              list running cities
//
// `skyline` connects Claude Code to the repo (hooks in .claude/settings.local.json, merged with
// anything already there, and git-ignored), starts a server for it (or reuses the running one) and
// opens the city. Running it again is safe. The first run builds the UI.
// Install once with `npm link` in the Agent Skyline folder.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServer, listServers, openBrowser, probe, serversFor, stopServer } from "../lib/autostart.mjs";
import { hookSettings } from "../lib/hookConfig.mjs";
import { resolveServersDir } from "../lib/paths.mjs";
import { ensureGitignored, removeRepoHooks, repoRoot, SETTINGS_REL, writeRepoHooks } from "../lib/repoSetup.mjs";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const USAGE = `usage:
  skyline [<dir>] [--port <n>] [--no-open]   connect this repo and open its city
  skyline off [<dir>]                         disconnect this repo and stop its server
  skyline status                              list running cities`;

function die(message) {
  console.error(message);
  process.exit(1);
}

function findRepo(dir) {
  const root = repoRoot(path.resolve(dir ?? "."));
  if (!root) die(`${path.resolve(dir ?? ".")} is not inside a git repository (run \`git init\` there first)`);
  return root;
}

function buildWebOnce() {
  if (existsSync(path.join(webDir, "dist", "index.html"))) return;
  console.log("First run: building the UI (once, about a minute)...");
  // npm is npm.cmd on Windows, which needs a shell; the arguments are fixed strings.
  for (const args of [["install"], ["run", "build"]]) {
    const r = spawnSync("npm", args, { cwd: webDir, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) die(`\`npm ${args.join(" ")}\` failed in ${webDir}`);
  }
}

async function start(dir, { port, open }) {
  const repo = findRepo(dir);
  buildWebOnce();

  const hooks = await writeRepoHooks(repo, hookSettings({ autostart: true, port }));
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

async function off(dir) {
  const repo = findRepo(dir);
  const hooks = await removeRepoHooks(repo);
  console.log(hooks.changed ? `hooks removed from ${hooks.file}` : "no Agent Skyline hooks in this repo");
  for (const r of serversFor(listServers(resolveServersDir()), repo)) {
    const result = await stopServer(r);
    if (result === "stopped") console.log(`stopped the city on port ${r.port}`);
    else if (result !== "gone") console.error(result);
  }
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
  if (positional[0] === "off") await off(positional[1]);
  else if (positional[0] === "status") await status();
  else if (positional[0] === "help") console.log(USAGE);
  else await start(positional[0], { port, open: !args.includes("--no-open") });
} catch (err) {
  die(err?.message ?? String(err));
}
