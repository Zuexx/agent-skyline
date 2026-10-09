// Scan a git repository into { root, files: [{ path, lines }] }.
// The file list comes from `git ls-files -z` (the index), so staged-but-uncommitted
// files are included; line counts come from disk, so the scan reflects what is on disk.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_COUNTED_BYTES = 2 * 1024 * 1024; // files over this size get lines: 0
const BINARY_PROBE_BYTES = 8000; // a \0 within the first N bytes means binary

export function scanRepo(root) {
  // The default 1 MB output cap is not enough for a big repo's file list (VS Code's is over 1 MB).
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });

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

function countLines(file, size) {
  if (size > MAX_COUNTED_BYTES) return 0;
  const buf = readFileSync(file);
  if (buf.subarray(0, Math.min(BINARY_PROBE_BYTES, buf.length)).includes(0)) return 0;
  let lines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) lines++; // \n
  }
  if (size > 0 && buf[buf.length - 1] !== 10) lines++; // last line without trailing newline
  return lines;
}
