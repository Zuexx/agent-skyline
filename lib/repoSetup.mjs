// Per-repo setup used by `skyline` and cli/install-hooks.mjs: find the repo root, add or remove
// Agent Skyline's hooks in <repo>/.claude/settings.local.json, and keep that file git-ignored.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasHooks, mergeHooks, removeHooks } from "./hookConfig.mjs";

export const SETTINGS_REL = ".claude/settings.local.json";

/** The top of the git work tree containing `dir`, or null when `dir` is not in one. */
export function repoRoot(dir) {
  try {
    return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return null;
  }
}

async function readSettings(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new Error(`${file} is not a JSON object; fix it by hand, it was left untouched`);
}

/** Add `ours` to the repo's settings.local.json, keeping everything else. { file, changed }. */
export async function writeRepoHooks(repo, ours) {
  const file = path.join(repo, SETTINGS_REL);
  const current = await readSettings(file);
  if (current && hasHooks(current, ours)) return { file, changed: false };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(mergeHooks(current ?? {}, ours), null, 2) + "\n", "utf8");
  return { file, changed: true };
}

/** Take Agent Skyline's hooks out of the repo's settings.local.json; delete the file if nothing else is left. { file, changed }. */
export async function removeRepoHooks(repo) {
  const file = path.join(repo, SETTINGS_REL);
  const current = await readSettings(file);
  if (!current) return { file, changed: false };
  const next = removeHooks(current);
  if (JSON.stringify(next) === JSON.stringify(current)) return { file, changed: false };
  if (Object.keys(next).length) await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  else {
    await rm(file, { force: true });
    await rmdir(path.dirname(file)).catch(() => {}); // only if .claude/ is now empty
  }
  return { file, changed: true };
}

/** Make sure settings.local.json is git-ignored in the repo, appending to .gitignore if needed. True if it was added. */
export async function ensureGitignored(repo) {
  const r = spawnSync("git", ["check-ignore", "-q", SETTINGS_REL], { cwd: repo, stdio: "ignore" });
  if (r.status === 0) return false;
  const file = path.join(repo, ".gitignore");
  let prefix = "";
  if (existsSync(file)) {
    const text = await readFile(file, "utf8");
    if (text.length && !text.endsWith("\n")) prefix = "\n";
  }
  await appendFile(file, `${prefix}\n# Agent Skyline hooks (local to this machine)\n${SETTINGS_REL}\n`, "utf8");
  return true;
}
