// Fallback for agents without hooks (and for people): watch the repo for file changes and log
// them as `source: "watcher"` write events. It cannot say who changed a file and it cannot block
// anything, but every change shows up, whatever made it.
//
// Two filters keep it quiet:
// - git-ignored paths (bin/, obj/, node_modules/, build output) are dropped via `git check-ignore`;
// - a change that an agent's hook already logged (same path, any non-watcher source, within the
//   settle window) is not logged twice.

import { execFileSync } from "node:child_process";
import { statSync, watch } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { rootKey } from "../lib/normalize.mjs";
import { tailJsonl } from "./tail.mjs";

const SETTLE_MS = 1500; // wait this long after a change before deciding to log it

/** Repo-relative paths (from `paths`) that git does not ignore. One git process per batch. */
export function notIgnored(repo, paths) {
  if (!paths.length) return [];
  let ignored = "";
  try {
    ignored = execFileSync("git", ["check-ignore", "--stdin", "-z"], { cwd: repo, input: paths.join("\0") + "\0", encoding: "utf8" });
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
  // If the event log lives inside the watched repo, its own appends must not be reported.
  const logRel = path.relative(path.resolve(repo), path.resolve(logFile)).replace(/\\/g, "/");
  const pending = new Map(); // relPath -> first-seen ms
  const hookWrites = new Map(); // relPath -> ms of the latest non-watcher write for this repo
  let timer = null;
  let closed = false;

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
    const ready = [...pending].filter(([, t]) => now - t >= settleMs).map(([p]) => p);
    for (const p of ready) pending.delete(p);
    const fresh = notIgnored(repo, ready.filter((p) => !isDirectory(path.join(repo, p)))).filter(
      (p) => !(now - (hookWrites.get(p) ?? 0) < settleMs * 2)
    );
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

// Folders change too (their mtime) but are not buildings. A deleted path is not a folder: keep it.
function isDirectory(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
