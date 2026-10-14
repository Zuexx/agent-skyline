// Is Agent Skyline's SessionStart hook still configured anywhere Claude Code reads hooks from?
//
// Claude Code keeps the hooks it loaded at startup for the whole session, so a session that was
// already open when `skyline off` ran still fires SessionStart on /clear, /compact and resume, and
// would start a fresh server (and its git calls) after the user turned Agent Skyline off. The hook
// asks this first and does nothing when no settings file it knows of still lists it.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { groupRoots, isSkylineGroup } from "./hookConfig.mjs";
import { rootKey } from "./normalize.mjs";

/** The settings files that can hold the hook: each dir's .claude/settings{,.local}.json and the user's ~/.claude/settings.json. */
export function settingsFiles(dirs, home = os.homedir()) {
  const files = [];
  for (const dir of dirs.filter(Boolean)) {
    for (const name of ["settings.local.json", "settings.json"]) files.push(path.join(path.resolve(dir), ".claude", name));
  }
  if (home) files.push(path.join(home, ".claude", "settings.json"));
  return [...new Set(files)];
}

/**
 * True when one of the files lists an Agent Skyline SessionStart hook for `repo`: one without
 * --root (it serves whatever project the session is in) or one whose --root is `repo`. A hook
 * left in the user's settings for another repo does not keep this one connected. Without `repo`,
 * any Agent Skyline SessionStart hook counts. A file that exists but cannot be read or parsed
 * counts as configured: never switch autostart off on a guess.
 */
export function autostartConfigured(files, repo = null) {
  const forRepo = (g) => {
    if (!repo) return true;
    const roots = groupRoots(g);
    return !roots || roots.some((r) => rootKey(path.resolve(r)) === rootKey(path.resolve(repo)));
  };
  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") continue;
      return true;
    }
    try {
      const groups = JSON.parse(raw || "{}")?.hooks?.SessionStart;
      if (Array.isArray(groups) && groups.some((g) => isSkylineGroup(g) && forRepo(g))) return true;
    } catch {
      return true;
    }
  }
  return false;
}
