// Shared data-file resolution for all Agent Skyline entry points (hooks and CLI).
// Every script resolves its files through this module so the three cannot drift.
//
// Each repo has its own folder, data/repos/<name>-<hash>/, holding events.jsonl, zones.json and
// scope.json. Zone globs are repo-relative, so one shared zones.json would lock `api/**` in every
// connected repo at once.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootKey } from "./normalize.mjs";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// The shared files from before per-repo folders; still used when no repo is known.
export const defaultLogFile = path.join(dataDir, "events.jsonl");
export const defaultZonesFile = path.join(dataDir, "zones.json");

function envValue(name) {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// AGENT_SKYLINE_DATA overrides where the per-repo folders live; the old shared files are read from
// its parent folder (data/ by default).
function reposDir() {
  return envValue("AGENT_SKYLINE_DATA") ?? path.join(dataDir, "repos");
}

/** Folder name for a repo root: readable name plus a hash of the comparable path. */
export function repoFolderName(root) {
  const abs = path.resolve(root);
  const name = (path.basename(abs) || "root").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  const hash = createHash("sha1").update(rootKey(abs)).digest("hex").slice(0, 10);
  return `${name}-${hash}`;
}

/**
 * The data folder for `root`. A session started in a subfolder of a connected repo uses the
 * repo's folder: the nearest parent that already has one wins.
 */
export function repoDataDir(root) {
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(reposDir(), repoFolderName(dir));
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(reposDir(), repoFolderName(root));
}

// AGENT_SKYLINE_EVENTS overrides the event log location; otherwise the repo's own log.
export function resolveLogFile(root = null) {
  return envValue("AGENT_SKYLINE_EVENTS") ?? (root ? path.join(repoDataDir(root), "events.jsonl") : defaultLogFile);
}

// Where auto-started servers record their PIDs (so they can be stopped by PID, never by name).
// AGENT_SKYLINE_SERVERS overrides it.
export function resolveServersDir() {
  return envValue("AGENT_SKYLINE_SERVERS") ?? path.join(dataDir, "servers");
}

// AGENT_SKYLINE_ZONES overrides the zones config location; otherwise the repo's own. The declared
// task scope (scope.json) lives next to it.
export function resolveZonesFile(root = null) {
  return envValue("AGENT_SKYLINE_ZONES") ?? (root ? path.join(repoDataDir(root), "zones.json") : defaultZonesFile);
}

async function copyIfPresent(from, to) {
  try {
    await copyFile(from, to);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

/**
 * Create the repo's data folder on first use, carrying over what the shared files held: the old
 * zones.json and scope.json (so nothing that was locked becomes unlocked) and this repo's events
 * from the shared log. The shared files are left as they were. Does nothing when an environment
 * override points the files elsewhere (tests, simulations). Returns the folder.
 */
export async function prepareRepoData(root) {
  if (!root || envValue("AGENT_SKYLINE_EVENTS") || envValue("AGENT_SKYLINE_ZONES")) return null;
  const dir = repoDataDir(root);
  if (existsSync(dir)) return dir;
  await mkdir(reposDir(), { recursive: true });
  try {
    await mkdir(dir); // not recursive: when two hooks race, only the one that creates it migrates
  } catch (err) {
    if (err?.code === "EEXIST") return dir;
    throw err;
  }
  const legacy = path.dirname(reposDir());
  // Zones first: a guard running alongside reads them as soon as the folder exists.
  await copyIfPresent(path.join(legacy, "zones.json"), path.join(dir, "zones.json"));
  await copyIfPresent(path.join(legacy, "scope.json"), path.join(dir, "scope.json"));
  let text = "";
  try {
    text = await readFile(path.join(legacy, "events.jsonl"), "utf8");
  } catch {
    return dir;
  }
  const key = rootKey(path.resolve(root));
  const ours = text.split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false;
    try {
      return JSON.parse(line)?.root === key;
    } catch {
      return false;
    }
  });
  if (ours.length) await writeFile(path.join(dir, "events.jsonl"), ours.join("\n") + "\n", "utf8");
  return dir;
}
