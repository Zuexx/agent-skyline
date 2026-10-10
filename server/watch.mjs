// Fallback for agents without hooks (and for people): watch the repo for file changes and log
// them as `source: "watcher"` write events. It cannot say who changed a file and it cannot block
// anything, but every change shows up, whatever made it.
//
// Three filters keep it quiet:
// - a notification without a content change (a read, on Windows) is dropped (see contentChanged);
// - git-ignored paths (bin/, obj/, node_modules/, build output) are dropped via `git check-ignore`
//   (outside git: paths in the folders the scan skips, see skippedPath);
// - a change that an agent's hook already logged (same path, any non-watcher source, within the
//   settle window) is not logged twice.

import { execFileSync } from "node:child_process";
import { statSync, watch } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { rootKey } from "../lib/normalize.mjs";
import { isWorkTree, skippedPath } from "./scan.mjs";
import { tailJsonl } from "./tail.mjs";

const SETTLE_MS = 1500; // wait this long after a change before deciding to log it
const MTIME_SLACK_MS = 3000; // a write's mtime can trail its notification slightly (clock, buffering)

/** Repo-relative paths (from `paths`) that git does not ignore. One git process per batch. */
export function notIgnored(repo, paths, git = true) {
  if (!paths.length) return [];
  if (!git) return paths.filter((p) => !skippedPath(p));
  let ignored = "";
  try {
    ignored = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      cwd: repo,
      input: paths.join("\0") + "\0",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, // a branch switch in a big repo can touch thousands of paths at once
    });
  } catch (err) {
    // Exit code 1 means "none of them are ignored"; anything else: be safe and report nothing.
    if (err.status === 1) return paths;
    return [];
  }
  const skip = new Set(ignored.split("\0").filter(Boolean));
  return paths.filter((p) => !skip.has(p));
}

/**
 * Start watching. Returns { close() }.
 * Options: repo, logFile, settleMs (tests shorten it), now (clock injection for tests).
 */
export function startWatcher({ repo, logFile, settleMs = SETTLE_MS }) {
  const root = rootKey(path.resolve(repo));
  const git = isWorkTree(repo);
  // If the event log lives inside the watched repo, its own appends must not be reported.
  const logRel = path.relative(path.resolve(repo), path.resolve(logFile)).replace(/\\/g, "/");
  const pending = new Map(); // relPath -> first-seen ms
  const hookWrites = new Map(); // relPath -> ms of the latest non-watcher write for this repo
  let timer = null;
  let closed = false;

  // On Windows a plain read fires the watcher too (libuv asks for last-access changes), so a
  // notification alone does not mean a write. A file counts as changed when its mtime/size differ
  // from what was last seen, or, the first time it is seen, when its mtime is about as new as the
  // notification. Folders are never buildings; a path that is gone was deleted and counts.
  const lastSig = new Map(); // relPath -> "mtimeMs:size"
  const contentChanged = (rel, seenAt) => {
    let st;
    try {
      st = statSync(path.join(repo, rel));
    } catch {
      lastSig.delete(rel);
      return true;
    }
    if (st.isDirectory()) return false;
    const sig = `${st.mtimeMs}:${st.size}`;
    const before = lastSig.get(rel);
    lastSig.set(rel, sig);
    if (before !== undefined) return before !== sig;
    return st.mtimeMs >= seenAt - MTIME_SLACK_MS;
  };

  // Learn what the hooks log, so their own writes are not echoed back.
  const tail = tailJsonl(logFile, {
    fromStart: false,
    onEvent: (ev) => {
      if (ev.source === "watcher" || (ev.root && ev.root !== root)) return;
      if (ev.kind !== "write" && ev.kind !== "blocked") return;
      for (const p of ev.paths ?? []) hookWrites.set(p, Date.now());
    },
  });

  const flush = async () => {
    timer = null;
    if (closed) return;
    const now = Date.now();
    const ready = [...pending].filter(([, t]) => now - t >= settleMs);
    for (const [p] of ready) pending.delete(p);
    const changed = ready.filter(([p, seen]) => contentChanged(p, seen)).map(([p]) => p);
    const fresh = notIgnored(repo, changed, git).filter((p) => !(now - (hookWrites.get(p) ?? 0) < settleMs * 2));
    if (fresh.length) {
      const lines = fresh.map((p) =>
        JSON.stringify({
          ts: new Date().toISOString(),
          session: "watcher",
          agent: null,
          event: "FileChange",
          tool: "fs",
          kind: "write",
          paths: [p],
          detail: null,
          root,
          source: "watcher",
        })
      );
      try {
        await mkdir(path.dirname(logFile), { recursive: true });
        await appendFile(logFile, lines.join("\n") + "\n", "utf8");
      } catch {
        // a failed append only loses fallback events; never take the server down for it
      }
    }
    if (pending.size && !timer) timer = setTimeout(flush, settleMs / 3);
  };

  const watcher = watch(repo, { recursive: true }, (_type, name) => {
    if (!name || closed) return;
    const rel = String(name).replace(/\\/g, "/");
    if (rel === ".git" || rel.startsWith(".git/")) return; // git's own churn; check-ignore does not cover it
    if (rel === logRel) return;
    if (!pending.has(rel)) pending.set(rel, Date.now());
    if (!timer) timer = setTimeout(flush, settleMs / 3);
  });
  watcher.on("error", () => {}); // e.g. a watched folder removed; keep the server running

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher.close();
      tail.close();
    },
  };
}

