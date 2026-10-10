// Locked-zone config loading and blocking decisions.
// loadZones does file I/O; decide is pure.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchGlob } from "./glob.mjs";
import { bashWriteTargets } from "./bashTargets.mjs";

// Read the zones config. A missing file means "no zones defined" (allow);
// an unreadable or malformed file is reported as invalid so callers can fail
// closed — a broken config means the user intended to lock something.
export async function loadZones(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return { status: "missing" };
    return { status: "invalid", error: `cannot read ${file}: ${err.message}` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { status: "invalid", error: `not valid JSON: ${err.message}` };
  }

  const locked = data !== null && typeof data === "object" ? data.locked : undefined;
  if (!Array.isArray(locked) || !locked.every((g) => typeof g === "string")) {
    return { status: "invalid", error: 'locked must be an array of strings' };
  }

  return { status: "ok", locked };
}

// Decide whether a normalized event is blocked by the zones config.
// Only write events can be blocked; everything else is allowed.
export function decide(event, zones) {
  const ev = event !== null && typeof event === "object" ? event : {};
  if (ev.kind !== "write") return { allow: true };

  const paths = Array.isArray(ev.paths) ? ev.paths.filter((p) => typeof p === "string") : [];

  if (zones.status === "missing") return { allow: true };

  if (zones.status === "invalid") {
    // Fail closed: the user meant to lock something.
    return {
      allow: false,
      reason: `agent-skyline: zones.json is invalid (${zones.error}); fix it or delete it`,
      path: paths[0] ?? null,
      zone: null,
    };
  }

  for (const p of paths) {
    for (const zone of zones.locked) {
      if (matchGlob(zone, p)) {
        return { allow: false, reason: `agent-skyline: ${p} is in locked zone "${zone}"`, path: p, zone };
      }
    }
  }

  return { allow: true };
}

// "/d/Labs/x" (Git Bash) and "D:\Labs\x" both become "d:/labs/x"-comparable "D:/Labs/x".
function toPosixAbs(p) {
  let s = String(p).replace(/\\/g, "/");
  const m = /^\/([a-z])\/(.*)$/i.exec(s);
  if (m) s = `${m[1]}:/${m[2]}`;
  return path.posix.normalize(s);
}

/**
 * Repo-relative paths a shell command would modify. `cwd` is where the command runs (it may be a
 * subfolder of the repo), `root` the repo root. Targets outside the repo are dropped.
 */
export function commandTargetsInRepo(command, cwd, root) {
  const base = toPosixAbs(cwd || root || ".");
  let r = toPosixAbs(root || cwd || ".");
  while (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  const out = [];
  for (const t of bashWriteTargets(command)) {
    const abs = /^([a-z]:)?\//i.test(toPosixAbs(t)) && (t.startsWith("/") || /^[a-z]:/i.test(t)) ? toPosixAbs(t) : path.posix.join(base, t);
    if (abs.toLowerCase() === r.toLowerCase()) continue;
    if (abs.toLowerCase().startsWith(r.toLowerCase() + "/")) out.push(abs.slice(r.length + 1));
  }
  return [...new Set(out)];
}

/**
 * Decision for a shell command: deny when anything it would modify is in a locked zone.
 * Same result shape as decide(); `paths` lists every target found.
 */
export function decideCommand(command, cwd, root, zones) {
  const paths = commandTargetsInRepo(command, cwd, root);
  if (!paths.length) return { allow: true, paths };
  const d = decide({ kind: "write", paths }, zones);
  if (d.allow) return { allow: true, paths };
  return { ...d, paths, reason: `agent-skyline: this command would modify ${d.path}, which is in locked zone "${d.zone}"` };
}
