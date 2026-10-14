// Per-repo setup used by `skyline` and cli/install-hooks.mjs: find the repo root, add or remove
// Agent Skyline's hooks in <repo>/.claude/settings.local.json, and keep that file git-ignored.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasHooks, hookSettings, mergeHooks, removeHooks } from "./hookConfig.mjs";

export const SETTINGS_REL = ".claude/settings.local.json";

/** The top of the git work tree containing `dir`, or null when `dir` is not in one. */
export function repoRoot(dir) {
  try {
    return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim());
  } catch {
    return null;
  }
}

/** The folder `skyline` connects: the git work tree containing `dir`, or `dir` itself outside git. */
export function projectRoot(dir) {
  return repoRoot(dir) ?? path.resolve(dir);
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

/**
 * What `skyline` writes: the hooks plus the SessionStart autostart, all reporting to `repo` (the
 * folder its server serves). In testing, a session started in a subfolder of `repo` did not load
 * these hooks, so they reach the city for sessions started in `repo` itself.
 */
export function connectRepoHooks(repo, { port = null } = {}) {
  return writeRepoHooks(repo, hookSettings({ autostart: true, port, root: repo }));
}

/**
 * Take Agent Skyline's hooks (all, or those `which(group)` accepts) out of the folder's
 * settings.local.json; delete the file if nothing else is left. { file, changed }.
 */
export async function removeRepoHooks(repo, which) {
  const file = path.join(repo, SETTINGS_REL);
  const current = await readSettings(file);
  if (!current) return { file, changed: false };
  const next = removeHooks(current, which);
  if (JSON.stringify(next) === JSON.stringify(current)) return { file, changed: false };
  if (Object.keys(next).length) await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  else {
    await rm(file, { force: true });
    await rmdir(path.dirname(file)).catch(() => {}); // only if .claude/ is now empty
  }
  return { file, changed: true };
}

/** Make sure settings.local.json is git-ignored in the repo, appending to .gitignore if needed. True if it was added. Outside git there is nothing to ignore. */
export async function ensureGitignored(repo) {
  if (!repoRoot(repo)) return false;
  const r = spawnSync("git", ["check-ignore", "-q", SETTINGS_REL], { cwd: repo, stdio: "ignore", windowsHide: true });
  if (r.status === 0) return false;
  const file = path.join(repo, ".gitignore");
  let prefix = "";
  if (existsSync(file)) {
    const text = await readFile(file, "utf8");
    if (text.length && !text.endsWith("\n")) prefix = "\n";
  }
  await appendFile(file, `${prefix}\n${IGNORE_NOTE}\n${SETTINGS_REL}\n`, "utf8");
  return true;
}

const IGNORE_NOTE = "# Agent Skyline hooks (local to this machine)";

/**
 * Undo ensureGitignored: take out the two lines it appended (and the blank line before them),
 * byte for byte, and delete .gitignore if nothing else is left. Lines the user wrote are never
 * touched. True if something was removed.
 */
export async function removeGitignored(repo) {
  const file = path.join(repo, ".gitignore");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return false;
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // $1 is the line break that ended the line before the block (or the start of the file); it stays.
  const block = new RegExp(`(^|\\r?\\n)\\r?\\n${esc(IGNORE_NOTE)}\\r?\\n${esc(SETTINGS_REL)}(?:\\r?\\n|$)`);
  if (!block.test(text)) return false;
  const next = text.replace(block, "$1");
  if (next.trim() === "") await rm(file, { force: true });
  else await writeFile(file, next, "utf8");
  return true;
}
