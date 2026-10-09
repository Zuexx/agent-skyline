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

/** Files of a ref's tree with line counts: [{ path, lines }], sorted. One cat-file process. */
export function treeFiles(root, ref) {
  requireRef(ref);
  const ls = git(root, ["ls-tree", "-r", "-z", "--full-tree", ref], { encoding: "buffer" });
  const entries = []; // { path, sha }
  for (const rec of ls.toString("utf8").split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [, type, sha] = rec.slice(0, tab).split(" ");
    if (type !== "blob") continue; // skip submodules
    entries.push({ path: rec.slice(tab + 1), sha });
  }
  if (!entries.length) return [];

  const out = git(root, ["cat-file", "--batch"], { input: entries.map((e) => e.sha).join("\n") + "\n" });
  const lines = new Map();
  let pos = 0;
  for (const e of entries) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString("utf8").split(" "); // <sha> blob <size>
    const size = Number(header[2]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    lines.set(e.sha, countLines(body));
    pos = nl + 1 + size + 1; // content is followed by a newline
  }
  return entries.map((e) => ({ path: e.path, lines: lines.get(e.sha) ?? 0 })).sort((a, b) => (a.path < b.path ? -1 : 1));
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
