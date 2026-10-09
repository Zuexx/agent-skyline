// Make sure a CodeCity server is running for a repo: reuse one that already serves it, otherwise
// start one in the background on the first free port. Used by the opt-in SessionStart hook.
//
// Ports base..base+tries-1 are probed. A port answering /api/health for this repo is reused; a
// port serving another repo (or anything else) is skipped; the first port nobody listens on is
// where a new server starts. Started servers record { pid, port, repo } in the servers dir, so
// `cli/stop-server.mjs` can stop them by PID.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootKey } from "./normalize.mjs";

const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "server.mjs");

/** GET /api/health on a port: { up: false } if nothing listens, else { up: true, health|null }. */
export async function probe(port, timeoutMs = 600) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { up: true, health: body?.app === "codecity" ? body : null };
  } catch (err) {
    // Refused = free. A timeout means something is there but not answering: treat it as taken.
    const refused = err?.cause?.code === "ECONNREFUSED" || err?.code === "ECONNREFUSED";
    return refused ? { up: false } : { up: true, health: null };
  }
}

const sameRepo = (a, b) => Boolean(a && b) && rootKey(path.resolve(a)) === rootKey(path.resolve(b));

/**
 * { url, port, started, pid? } for the repo's server, starting one if needed; null when every
 * probed port is taken by something else.
 */
export async function ensureServer({ repo, basePort = 4477, tries = 10, serversDir, waitMs = 8000 }) {
  let free = null;
  for (let port = basePort; port < basePort + tries; port++) {
    const p = await probe(port);
    if (p.up && sameRepo(p.health?.repoPath, repo)) return { url: `http://127.0.0.1:${port}`, port, started: false };
    if (!p.up && free == null) free = port;
  }
  if (free == null) return null;

  const child = spawn(process.execPath, [serverScript, "--repo", repo, "--port", String(free)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  if (serversDir) {
    mkdirSync(serversDir, { recursive: true });
    writeFileSync(
      path.join(serversDir, `${free}.json`),
      JSON.stringify({ pid: child.pid, port: free, repo: path.resolve(repo), started: new Date().toISOString() }, null, 2) + "\n"
    );
  }
  // Wait until it answers, so a browser opened next does not land on a refused connection.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const p = await probe(free, 400);
    if (p.up && sameRepo(p.health?.repoPath, repo)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { url: `http://127.0.0.1:${free}`, port: free, started: true, pid: child.pid };
}

/** Open a URL in the default browser, detached. */
export function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]] // no shell, so no quoting rules to get wrong
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.on("error", () => {});
  child.unref();
}
