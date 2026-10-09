// Git queries for comparing a branch with its base, without touching the working tree:
// everything reads objects (ls-tree, cat-file, diff between refs), so the agent can keep working
// on whatever branch is checked out.
//
// Every ref comes from an HTTP query string, so it is validated before it reaches git, and git is
// always run with execFileSync (no shell) and refs placed after options.

import { execFileSync } from "node:child_process";

const MAX_COUNTED_BYTES = 2 * 1024 * 1024; // same limits as scan.mjs
const BINARY_PROBE_BYTES = 8000;
const MAX_FILE_DIFF_BYTES = 200 * 1024;

/** A ref name we are willing to pass to git: no option look-alikes, no ranges, no odd bytes. */
export function isValidRef(ref) {
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    ref.length <= 200 &&
    !ref.startsWith("-") &&
    !ref.includes("..") &&
    /^[A-Za-z0-9._\/-]+$/.test(ref)
  );
}

function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024, ...opts });
}

function requireRef(ref) {
  if (!isValidRef(ref)) throw Object.assign(new Error(`invalid ref: ${ref}`), { status: 400 });
}

/** { current, branches } — local branch names; `current` is null on a detached HEAD. */
export function listBranches(root) {
  const out = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], { encoding: "utf8" });
  const branches = out.split("\n").filter(Boolean).sort();
  let current = null;
  try {
    current = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" }).trim() || null;
  } catch {
    current = null; // detached HEAD
  }
  return { current, branches };
}

function countLines(buf) {
  if (buf.length > MAX_COUNTED_BYTES) return 0;
  if (buf.subarray(0, Math.min(BINARY_PROBE_BYTES, buf.length)).includes(0)) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf.length > 0 && buf[buf.length - 1] !== 10) n++;
  return n;
}

/** Blob entries of a ref's tree: [{ path, sha }]. */
function treeEntries(root, ref) {
  requireRef(ref);
  const ls = git(root, ["ls-tree", "-r", "-z", "--full-tree", ref], { encoding: "buffer" });
  const entries = [];
  for (const rec of ls.toString("utf8").split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [, type, sha] = rec.slice(0, tab).split(" ");
    if (type !== "blob") continue; // skip submodules
    entries.push({ path: rec.slice(tab + 1), sha });
  }
  return entries;
}

/** Contents of many blobs in one cat-file process: Map sha -> Buffer. */
function readBlobs(root, shas) {
  const bodies = new Map();
  if (!shas.length) return bodies;
  const out = git(root, ["cat-file", "--batch"], { input: shas.join("\n") + "\n" });
  let pos = 0;
  for (const sha of shas) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString("utf8").split(" "); // <sha> blob <size>
    const size = Number(header[2]);
    bodies.set(sha, out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1; // content is followed by a newline
  }
  return bodies;
}

/** Files of a ref's tree with line counts: [{ path, lines }], sorted. One cat-file process. */
export function treeFiles(root, ref) {
  const entries = treeEntries(root, ref);
  const bodies = readBlobs(root, entries.map((e) => e.sha));
  return entries.map((e) => ({ path: e.path, lines: countLines(bodies.get(e.sha) ?? Buffer.alloc(0)) })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * The ref's file list and a reader for the files `wanted(path)` accepts, loaded up front in one
 * cat-file process: { paths, read(path) -> text | null }. Large files read as null.
 */
export function refReader(root, ref, wanted) {
  const entries = treeEntries(root, ref);
  const picked = entries.filter((e) => wanted(e.path));
  const bodies = readBlobs(root, picked.map((e) => e.sha));
  const texts = new Map(
    picked.map((e) => {
      const b = bodies.get(e.sha);
      return [e.path, b && b.length <= MAX_COUNTED_BYTES ? b.toString("utf8") : null];
    })
  );
  return { paths: entries.map((e) => e.path).sort(), read: (p) => texts.get(p) ?? null };
}

/**
 * Changes on `head` since it branched from `base` (three-dot: merge-base...head), with renames.
 * [{ path, status: "A"|"M"|"D"|"R", added, removed, oldPath? }]
 */
export function diffFiles(root, base, head) {
  requireRef(base);
  requireRef(head);
  const range = `${base}...${head}`;
  const status = git(root, ["diff", "--name-status", "-z", "-M", range, "--"], { encoding: "utf8" }).split("\0");
  const files = new Map();
  for (let i = 0; i < status.length; ) {
    const code = status[i++];
    if (!code) continue;
    const s = code[0];
    if (s === "R" || s === "C") {
      const oldPath = status[i++];
      const path = status[i++];
      files.set(path, { path, status: "R", oldPath, added: 0, removed: 0 });
    } else {
      const path = status[i++];
      files.set(path, { path, status: s === "A" || s === "D" ? s : "M", added: 0, removed: 0 });
    }
  }
  // --numstat -z: "<added>\t<removed>\t<path>\0", or for renames "<a>\t<r>\t\0<old>\0<new>\0".
  const num = git(root, ["diff", "--numstat", "-z", "-M", range, "--"], { encoding: "utf8" }).split("\0");
  for (let i = 0; i < num.length; ) {
    const rec = num[i++];
    if (!rec) continue;
    const [a, r, p] = rec.split("\t");
    const path = p === "" ? (i++, num[i++]) : p; // rename: skip old path, take new
    const f = files.get(path);
    if (f) {
      f.added = a === "-" ? 0 : Number(a);
      f.removed = r === "-" ? 0 : Number(r);
    }
  }
  return [...files.values()].sort((x, y) => (x.path < y.path ? -1 : 1));
}

/**
 * How often each file changed recently: { days, commits: { path: count } } from the last `days`
 * days of history on HEAD (capped at `maxCommits`). High churn is where bugs tend to live.
 */
export function churn(root, days = 90, maxCommits = 3000) {
  let out = "";
  try {
    out = git(root, ["log", `--since=${days}.days`, `-n${maxCommits}`, "--no-merges", "--name-only", "--format=%x00", "-z"], {
      encoding: "utf8",
    });
  } catch {
    return { days, commits: {} }; // no commits yet
  }
  const commits = {};
  // -z with --format=%x00: commits are separated by NULs, file names by NULs/newlines.
  for (const name of out.split(/[\0\n]/)) {
    const p = name.trim();
    if (p) commits[p] = (commits[p] ?? 0) + 1;
  }
  return { days, commits };
}

/** Unified diff of one file on `head` since `base` (three-dot), capped in size. */
export function fileDiff(root, base, head, path) {
  requireRef(base);
  requireRef(head);
  if (typeof path !== "string" || !path || path.startsWith("-") || path.includes("\0")) {
    throw Object.assign(new Error("invalid path"), { status: 400 });
  }
  const out = git(root, ["diff", "-M", "--no-color", `${base}...${head}`, "--", path], { encoding: "buffer" });
  const truncated = out.length > MAX_FILE_DIFF_BYTES;
  return { text: out.subarray(0, MAX_FILE_DIFF_BYTES).toString("utf8"), truncated };
}
