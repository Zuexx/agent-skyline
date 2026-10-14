// Make sure an Agent Skyline server is running for a repo: reuse one that already serves it, otherwise
// start one in the background on the first free port. Used by the opt-in SessionStart hook.
//
// Ports base..base+tries-1 are probed. A port answering /api/health for this repo is reused; a
// port serving another repo (or anything else) is skipped; the first port nobody listens on is
// where a new server starts. Started servers record { pid, port, repo } in the servers dir, so
// `cli/stop-server.mjs` can stop them by PID.

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootKey } from "./normalize.mjs";

const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "server.mjs");

/**
 * GET /api/health on a port: { up: false } if nothing listens, else { up: true, health|null }.
 * `silent: true` marks a port that is taken but did not answer in time, e.g. a server whose event
 * loop is busy in a synchronous git call; `health: null` alone means something else answered.
 */
export async function probe(port, timeoutMs = 600) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { up: true, health: body?.app === "agent-skyline" ? body : null };
  } catch (err) {
    // Refused = free. A timeout means something is there but not answering: treat it as taken.
    const refused = err?.cause?.code === "ECONNREFUSED" || err?.code === "ECONNREFUSED";
    return refused ? { up: false } : { up: true, health: null, silent: true };
  }
}

const sameRepo = (a, b) => Boolean(a && b) && rootKey(path.resolve(a)) === rootKey(path.resolve(b));

/** True when `dir` is `repo` or a folder inside it (a server an older hook started for a subfolder). */
export function withinRepo(dir, repo) {
  if (!dir || !repo) return false;
  const d = rootKey(path.resolve(dir));
  const r = rootKey(path.resolve(repo));
  return d === r || d.startsWith(r.endsWith("/") ? r : `${r}/`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** The servers recorded in `serversDir`: [{ file, pid, port, repo, started }]. */
export function listServers(serversDir) {
  try {
    return readdirSync(serversDir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => ({ file: path.join(serversDir, f), ...JSON.parse(readFileSync(path.join(serversDir, f), "utf8")) }));
  } catch {
    return []; // no directory yet: nothing was started
  }
}

/** The recorded servers that serve `repo`. */
export const serversFor = (records, repo) => records.filter((r) => sameRepo(r.repo, repo));

// Kill `pid`, which just answered /api/health on `port`, and wait until the port is free.
async function killServer(port, pid, waitMs = 5000) {
  try {
    process.kill(pid);
  } catch (err) {
    if (err?.code !== "ESRCH") return `could not stop pid ${pid}: ${err.message}`;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!(await probe(port, 300)).up) return "stopped";
    await sleep(100);
  }
  return `pid ${pid} on port ${port} did not stop`;
}

// Probe a port, giving a busy server (event loop held by a synchronous git call) a few chances.
async function patientProbe(port, { timeoutMs = 3000, tries = 3 } = {}) {
  let p = await probe(port, timeoutMs);
  for (let i = 1; i < tries && p.silent; i++) p = await probe(port, timeoutMs);
  return p;
}

const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // exists, owned by someone else
  }
};

// How long after its start a server that is not listening yet may still be booting (node startup
// plus an antivirus scan on Windows can take seconds). Past this, a live PID on a silent, free port
// is taken to be a reused PID, not our server.
export const BOOT_GRACE_MS = 120_000;

/**
 * Stop a recorded server by its PID and drop its record. Only kills the PID if that port is still
 * an Agent Skyline with that PID, since PIDs get reused. "stopped" | "gone" | an error message.
 * The record is dropped only once the server is known to be gone: a port that is taken but does
 * not answer, a kill that did not take, or a PID still alive that started recently and is not
 * listening yet all keep it, since dropping it would leave a server running that nothing could
 * find again.
 */
export async function stopServer(record, probeOpts, { now = Date.now() } = {}) {
  const p = await patientProbe(record.port, probeOpts);
  if (p.silent) return `port ${record.port} did not answer; pid ${record.pid} may still be running (its record is kept, run this again)`;
  if (p.health?.pid === record.pid) {
    const result = await killServer(record.port, record.pid);
    if (result === "stopped") rmSync(record.file, { force: true });
    return result;
  }
  const startedAt = Date.parse(record.started ?? "");
  const booting = !p.up && pidAlive(record.pid) && Number.isFinite(startedAt) && now - startedAt < BOOT_GRACE_MS;
  if (booting) return `pid ${record.pid} is running but port ${record.port} is not listening yet (its record is kept, run this again in a few seconds)`;
  rmSync(record.file, { force: true });
  return "gone";
}

/**
 * Stop every Agent Skyline server for `repo` (or a folder inside it): the recorded ones by PID,
 * then any other that answers on `ports` or a recorded port for that repo, by the PID it reports
 * itself (one started by hand, or whose record was lost or overwritten). [{ port, pid, result }].
 */
export async function stopRepoServers({ repo, serversDir, ports = [], probeOpts } = {}) {
  const results = [];
  const records = listServers(serversDir);
  for (const r of records.filter((r) => withinRepo(r.repo, repo))) results.push({ port: r.port, pid: r.pid, result: await stopServer(r, probeOpts) });
  const handled = new Set(results.map((r) => r.port));
  for (const port of new Set([...ports, ...records.map((r) => r.port)])) {
    const p = await patientProbe(port, probeOpts);
    // Busy and unrecorded: it may be this repo's city or anything else; say so rather than skip it quietly.
    if (p.silent && !handled.has(port)) results.push({ port, pid: null, result: `port ${port} is taken but did not answer; if it is an Agent Skyline city, run \`skyline off\` again` });
    if (!Number.isInteger(p.health?.pid) || !withinRepo(p.health.repoPath, repo)) continue;
    const result = await killServer(port, p.health.pid);
    if (result === "stopped") for (const r of records.filter((r) => r.port === port)) rmSync(r.file, { force: true });
    results.push({ port, pid: p.health.pid, result });
  }
  return results;
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
