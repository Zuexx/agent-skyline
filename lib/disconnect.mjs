// `skyline off`: undo everything `skyline` did for a repo.
//
//   1. its hooks in <repo>/.claude/settings.local.json (the file goes when nothing else is left),
//   2. its hooks in any <repo>/<sub>/.claude/settings.local.json (`install-hooks.mjs <sub> --write`,
//      or `skyline` run in a non-git subfolder), except in nested repos and hooks reporting to a
//      folder outside this repo: those are other connections,
//   3. the .gitignore lines it added, once that file is gone (while the file stays, so does the ignore),
//   4. every Agent Skyline server for the repo or a folder inside it: recorded ones by PID, and any
//      other that answers on the port range for this repo (started by hand, or its record lost).
//
// Hooks in files skyline never writes (.claude/settings.json in the repo or a subfolder, which is
// usually committed, and the user's ~/.claude/settings.json) are listed, not edited: they were
// pasted there by hand (install-hooks.mjs prints them for that) and keep Agent Skyline running.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stopRepoServers, withinRepo } from "./autostart.mjs";
import { groupRoots, isSkylineGroup } from "./hookConfig.mjs";
import { removeGitignored, removeRepoHooks } from "./repoSetup.mjs";

// Folders the walk for .claude/ never enters (as server/scan.mjs): hidden ones and dependency trees.
const SKIP_DIRS = new Set(["node_modules", "__pycache__", "venv", "env", "site-packages", "python_embeded", "bower_components", "dist", "build", "target", "bin", "obj"]);
const MAX_DEPTH = 8;
const MAX_DIRS = 20000;

/** Subfolders of `repo` (not `repo` itself) that have a .claude/ folder, skipping nested git repos. */
export function claudeDirsBelow(repo) {
  const found = [];
  let seen = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || seen++ > MAX_DIRS) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (depth > 0) {
      if (entries.some((e) => e.name === ".git")) return; // a nested repo or submodule: its own connection
      if (entries.some((e) => e.name === ".claude" && e.isDirectory())) found.push(dir);
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name.toLowerCase())) continue; // symlinks are not followed
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(repo), 0);
  return found;
}

// The Agent Skyline hook events in a settings file, or null when it holds none (or cannot be read).
function skylineEvents(file) {
  try {
    const hooks = JSON.parse(readFileSync(file, "utf8") || "{}")?.hooks ?? {};
    const events = Object.entries(hooks)
      .filter(([, groups]) => Array.isArray(groups) && groups.some(isSkylineGroup))
      .map(([event]) => event);
    return events.length ? events : null;
  } catch {
    return null;
  }
}

/**
 * { hooks, subHooks, ignore, servers, leftovers }: what was removed, and `leftovers`
 * [{ file, events }] for the Agent Skyline hooks that are still configured in files `off` does
 * not edit. `home` is the user's home folder (tests pass a temp one).
 */
export async function disconnectRepo({ repo, serversDir, basePort = 4477, tries = 10, probeOpts, home = os.homedir() } = {}) {
  const hooks = await removeRepoHooks(repo);
  const subs = claudeDirsBelow(repo);
  // In a subfolder, a hook with --root elsewhere belongs to another repo; one without --root reports
  // to that subfolder, which is inside this repo.
  const ours = (g) => {
    const roots = groupRoots(g);
    return !roots || roots.some((r) => withinRepo(r, repo));
  };
  const subHooks = [];
  for (const dir of subs) {
    const r = await removeRepoHooks(dir, ours).catch((err) => ({ file: path.join(dir, ".claude", "settings.local.json"), changed: false, error: err.message }));
    if (r.changed || r.error) subHooks.push(r);
  }
  const ignore = !existsSync(hooks.file) && (await removeGitignored(repo));
  const ports = Array.from({ length: tries }, (_, i) => basePort + i);
  const servers = await stopRepoServers({ repo, serversDir, ports, probeOpts });

  const candidates = [repo, ...subs].map((d) => path.join(d, ".claude", "settings.json"));
  for (const r of subHooks) if (r.error) candidates.push(r.file); // could not be edited: still there
  if (home) candidates.push(path.join(home, ".claude", "settings.json"));
  const leftovers = [];
  for (const file of new Set(candidates)) {
    const events = skylineEvents(file);
    if (events) leftovers.push({ file, events });
  }
  return { hooks, subHooks, ignore, servers, leftovers };
}
