// Scan a folder into { root, files: [{ path, lines }] }.
// In a git work tree the file list comes from `git ls-files` (the index plus untracked files that
// are not ignored), so new and staged-but-uncommitted files are included. Any other folder is
// walked on disk, skipping the usual dependency/cache folders (see skippedPath). Line counts come
// from disk, so the scan reflects what is on disk.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_COUNTED_BYTES = 2 * 1024 * 1024; // files over this size get lines: 0
const BINARY_PROBE_BYTES = 8000; // a \0 within the first N bytes means binary
export const MAX_WALK_FILES = 20000; // a folder walk stops here, so a huge non-repo folder stays usable

// Folders a walk never enters: what a .gitignore would usually hide. Hidden folders (.git, .venv,
// .cache, ...) are skipped as well.
const SKIP_DIRS = new Set(["node_modules", "__pycache__", "venv", "env", "site-packages", "python_embeded", "bower_components"]);
const skipDir = (name) => name.startsWith(".") || SKIP_DIRS.has(name.toLowerCase());

/** True for a "/"-separated relative path inside a folder a walk skips. */
export function skippedPath(rel) {
  return rel.split("/").slice(0, -1).some(skipDir);
}

/** True when `dir` is inside a git work tree. */
export function isWorkTree(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
  } catch {
    return false; // not a repo, or git is not installed
  }
}

export function scanRepo(root) {
  const paths = isWorkTree(root) ? gitPaths(root) : walkPaths(root);
  const files = [];
  for (const p of paths) {
    const abs = path.join(root, ...p.split("/"));
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // listed by git but missing on disk -> skip
    }
    if (!st.isFile()) continue;
    files.push({ path: p, lines: countLines(abs, st.size) });
  }

  return { root, files };
}

function gitPaths(root) {
  // Tracked files plus untracked ones git does not ignore: a file an agent just created is a
  // building before anyone runs `git add`. The default 1 MB output cap is not enough for a big
  // repo's file list (VS Code's is over 1 MB).
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });

  // -z output is NUL-separated; split manually so paths with any byte survive.
  const paths = [];
  let start = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === 0) {
      const p = out.subarray(start, i).toString("utf8");
      if (p !== "") paths.push(p);
      start = i + 1;
    }
  }
  paths.sort();
  // A path can be listed twice (e.g. staged with unmerged entries); keep one.
  for (let i = paths.length - 1; i > 0; i--) if (paths[i] === paths[i - 1]) paths.splice(i, 1);
  return paths;
}

// Breadth-first, so a capped walk keeps the top of the folder rather than one deep corner.
// Symlinks are not followed.
function walkPaths(root) {
  const paths = [];
  const queue = [""];
  while (queue.length && paths.length < MAX_WALK_FILES) {
    const rel = queue.shift();
    let entries;
    try {
      entries = readdirSync(rel ? path.join(root, ...rel.split("/")) : root, { withFileTypes: true });
    } catch {
      continue; // unreadable folder
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skipDir(e.name)) queue.push(p);
      } else if (e.isFile() && paths.length < MAX_WALK_FILES) paths.push(p);
    }
  }
  return paths.sort();
}

function countLines(file, size) {
  if (size > MAX_COUNTED_BYTES) return 0;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return 0; // locked or unreadable (e.g. a file another process holds open on Windows)
  }
  if (buf.subarray(0, Math.min(BINARY_PROBE_BYTES, buf.length)).includes(0)) return 0;
  let lines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) lines++; // \n
  }
  if (size > 0 && buf[buf.length - 1] !== 10) lines++; // last line without trailing newline
  return lines;
}
