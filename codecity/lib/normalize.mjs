// Pure normalization of Claude Code hook payloads into event records.
// No I/O, no dependencies. Missing or malformed fields never throw; they
// produce null / [] / "other".

import path from "node:path";

// Long enough to keep the file paths in a typical multi-step Bash command, which the city uses
// to light up files read through the shell; still bounded so one event stays a small line.
const TRUNCATE_AT = 2000;

function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Also collapses "." and ".." segments, so "api/../api/Anvil/x.cs" cannot slip
// past a zone glob like "api/Anvil/**".
function toPosix(p) {
  return path.posix.normalize(p.replace(/\\/g, "/"));
}

// Make rawPath relative to cwd when it is inside cwd. The prefix match is
// case-insensitive so Windows drive-letter / case differences do not break
// relativizing. Paths outside cwd are kept absolute. Always returns a
// "/"-separated string; "" means the path equals cwd itself.
function relativize(rawPath, cwd) {
  const p = toPosix(rawPath);
  if (!cwd) return p;
  let c = toPosix(cwd);
  while (c.length > 1 && c.endsWith("/")) c = c.slice(0, -1);
  const pl = p.toLowerCase();
  const cl = c.toLowerCase();
  if (pl === cl) return "";
  if (cl !== "" && pl.startsWith(cl + "/")) return p.slice(c.length + 1);
  return p;
}

// `root` overrides payload.cwd as the base for relative paths. The hook passes
// CLAUDE_PROJECT_DIR, which stays fixed while the session's cwd follows `cd`.
// `source` names the tool that produced the event (claude-code, pi, watcher, ...), so the city
// can tell agents of different kinds apart.
export function normalize(payload, now = new Date(), root = null, source = "claude-code") {
  const p = payload !== null && typeof payload === "object" ? payload : {};
  const input = p.tool_input !== null && typeof p.tool_input === "object" ? p.tool_input : {};
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  const session = asString(p.session_id);
  const agent = asString(p.agent_id);
  const event = asString(p.hook_event_name);
  const tool = asString(p.tool_name);
  const cwd = asString(root) ?? asString(p.cwd);

  let kind = "other";
  let pathKey = null;
  let detail = null;

  if (tool === "Read") {
    kind = "read";
    pathKey = "file_path";
  } else if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
    kind = "write";
    pathKey = "file_path";
  } else if (tool === "NotebookEdit") {
    kind = "write";
    pathKey = "notebook_path";
  } else if (tool === "Glob" || tool === "Grep") {
    kind = "search";
    pathKey = "path";
    detail = asString(input.pattern);
  } else if (tool === "Bash" || tool === "PowerShell") {
    kind = "exec";
    detail = asString(input.command);
  }

  let paths = [];
  if (pathKey !== null) {
    const raw = input[pathKey];
    if (typeof raw === "string" && raw.length > 0) {
      const rel = relativize(raw, cwd);
      if (rel !== "") paths = [rel];
    }
  }

  if (detail !== null) detail = detail.slice(0, TRUNCATE_AT);

  // `root` records which repo the event belongs to: one event log serves every repo, and a
  // README.md read in another project must not light up this project's README.md.
  return { ts: date.toISOString(), session, agent, event, tool, kind, paths, detail, root: cwd ? rootKey(cwd) : null, source };
}

/** Comparable form of a repo root: "/" separators, no trailing slash, lower case. */
export function rootKey(dir) {
  let s = toPosix(String(dir ?? ""));
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.toLowerCase();
}
