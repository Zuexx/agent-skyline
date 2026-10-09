// CodeCity HTTP entry point: turns a git repo into city layout JSON, streams the event log
// live over SSE, and reads/writes the zones file. Zero npm dependencies; listens on
// 127.0.0.1 only. `createServer` returns an un-listening http.Server so tests can bind port 0.

import http from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "./scan.mjs";
import { layout } from "./layout.mjs";
import { diffFiles, fileDiff, listBranches, treeFiles } from "./git.mjs";
import { tailJsonl } from "./tail.mjs";
import { loadZones } from "../lib/zones.mjs";
import { resolveLogFile, resolveZonesFile } from "../lib/paths.mjs";
import { rootKey } from "../lib/normalize.mjs";
import { startWatcher } from "./watch.mjs";
import { buildDeps } from "./deps.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWebRoot = path.join(here, "..", "web", "dist"); // step 4 builds this folder

const MAX_ZONES_BODY_BYTES = 64 * 1024; // PUT /api/zones body limit
const MAX_LOCKED_ENTRIES = 200;
// Events replayed to a new SSE client. Large enough to cover a whole working session, so the
// "touched this session" view is complete; the UI batches the replay into one render.
const REPLAY_LIMIT = 5000;
const PING_INTERVAL_MS = 15_000;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

// Read the log and return up to `limit` trailing events, using the same line rules as the
// tailer: complete lines only (the file is read whole), non-object JSON skipped. A missing
// file means "no history yet".
async function readLastEvents(file, limit) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // not valid JSON -> skip the line
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) continue;
    events.push(event);
  }
  return events.slice(-limit);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

async function sendFile(res, file) {
  const data = await readFile(file);
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  res.end(data);
}

// Serve codecity/web/dist if it exists: a real file when the path maps to one inside dist,
// otherwise index.html (SPA fallback). Path traversal outside dist is rejected.
async function serveStatic(res, url, distRoot) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    json(res, 400, { error: "invalid path" });
    return;
  }
  const resolved = path.resolve(distRoot, "." + (pathname.startsWith("/") ? "" : "/") + pathname);
  if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
    json(res, 403, { error: "forbidden" }); // decoded path escapes web/dist
    return;
  }
  let rootStat;
  try {
    rootStat = await stat(distRoot);
  } catch {
    text(res, 404, "web UI not built");
    return;
  }
  if (!rootStat.isDirectory()) {
    text(res, 404, "web UI not built");
    return;
  }
  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch {
    // unknown file -> fall through to index.html
  }
  if (fileStat && fileStat.isFile()) {
    await sendFile(res, resolved);
    return;
  }
  const index = path.join(distRoot, "index.html");
  try {
    const indexStat = await stat(index);
    if (indexStat.isFile()) {
      await sendFile(res, index);
      return;
    }
  } catch {
    // no index either
  }
  text(res, 404, "not found");
}

// webRoot is overridable so tests do not depend on whether web/dist has been built.
export function createServer({ repo, logFile, zonesFile, scopeFile = null, webRoot = defaultWebRoot }) {
  // The declared task scope lives next to the zones file unless given (tests pass their own).
  const scopePath = scopeFile ?? path.join(path.dirname(zonesFile), "scope.json");
  const loadScope = async () => {
    try {
      const data = JSON.parse(await readFile(scopePath, "utf8"));
      return { allow: Array.isArray(data.allow) ? data.allow.filter((g) => typeof g === "string") : [] };
    } catch {
      return { allow: [] }; // missing or unreadable: nothing declared, the UI infers instead
    }
  };
  let cityCache = null;
  // Absolute, "/"-separated repo path, so the UI can build editor links (vscode://file/...).
  const repoPath = path.resolve(repo).split(path.sep).join("/");

  let depsCache = null;

  async function getCity(forceRescan) {
    if (cityCache && !forceRescan) return cityCache;
    const scanned = scanRepo(repo); // throws if `repo` is not a git work tree -> 500 by the router
    cityCache = { repo, repoPath, ...layout(scanned.files) };
    depsCache = null; // the file set may have changed
    return cityCache;
  }

  // Working-tree dependencies, computed on first request and kept until the next rescan.
  async function getDeps() {
    const city = await getCity(false);
    depsCache ??= buildDeps(repo, city.buildings.map((b) => b.path));
    return depsCache;
  }

  // The city of another branch, read from git objects (the working tree is left alone). With a
  // base, files the branch deleted are kept as buildings too, so the deletion has a place to show.
  function getRefCity(ref, base) {
    const files = treeFiles(repo, ref);
    if (base) {
      const have = new Set(files.map((f) => f.path));
      for (const d of diffFiles(repo, base, ref)) {
        if (d.status === "D" && !have.has(d.path)) files.push({ path: d.path, lines: d.removed });
      }
      files.sort((a, b) => (a.path < b.path ? -1 : 1));
    }
    return { repo, ref, ...layout(files) };
  }

  async function handleGetZones(res) {
    const zones = await loadZones(zonesFile);
    json(res, 200, { status: zones.status, locked: zones.status === "ok" ? zones.locked : [] });
  }

  // Validate the body (size while streaming, shape after), write atomically via <file>.tmp +
  // rename, then reload so the response is what is actually on disk. Shared by the locked-zone
  // list ({ locked }) and the declared task scope ({ allow }): both are lists of globs.
  function handlePutZones(req, res) {
    handlePutList(req, res, zonesFile, "locked", async () => {
      const zones = await loadZones(zonesFile);
      return { status: zones.status, locked: zones.locked ?? [] };
    });
  }

  function handlePutList(req, res, file, key, reload) {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_ZONES_BODY_BYTES) {
        rejected = true;
        json(res, 400, { error: `body exceeds ${MAX_ZONES_BODY_BYTES} bytes` });
        req.destroy(); // stop receiving the oversized body
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", async () => {
      if (rejected || res.writableEnded) return;
      try {
        let data;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          json(res, 400, { error: "body is not valid JSON" });
          return;
        }
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
          json(res, 400, { error: `body must be a JSON object like { "${key}": [...] }` });
          return;
        }
        const list = data[key];
        if (!Array.isArray(list)) {
          json(res, 400, { error: `"${key}" must be an array of strings` });
          return;
        }
        if (list.length > MAX_LOCKED_ENTRIES) {
          json(res, 400, { error: `at most ${MAX_LOCKED_ENTRIES} ${key} entries` });
          return;
        }
        if (!list.every((entry) => typeof entry === "string" && entry.length > 0)) {
          json(res, 400, { error: `each ${key} entry must be a non-empty string` });
          return;
        }

        await mkdir(path.dirname(file), { recursive: true });
        const tmp = file + ".tmp";
        await writeFile(tmp, JSON.stringify({ [key]: list }, null, 2) + "\n", "utf8");
        await rename(tmp, file); // atomic replace (libuv replaces an existing destination on all platforms)

        json(res, 200, await reload());
      } catch (err) {
        if (!res.headersSent) json(res, 500, { error: err.message });
        else res.end();
      }
    });

    req.on("error", () => {}); // client went away mid-body; nothing to do
  }

  // Events from other repos share the log; only this repo's go out. Events written before roots
  // were recorded have none and are kept, so existing logs still replay.
  const repoKey = rootKey(path.resolve(repo));
  const ours = (ev) => !ev.root || ev.root === repoKey;

  async function handleEvents(req, res) {
    const history = (await readLastEvents(logFile, REPLAY_LIMIT * 2)).filter(ours).slice(-REPLAY_LIMIT);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    let closed = false;
    const send = (event) => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // socket already gone; the close handler below does the cleanup
      }
    };
    for (const event of history) send(event);

    const tail = tailJsonl(logFile, { fromStart: false, onEvent: (ev) => ours(ev) && send(ev) });
    const ping = setInterval(() => {
      if (!closed) {
        try {
          res.write(": ping\n\n");
        } catch {
          // ignore; close handler cleans up
        }
      }
    }, PING_INTERVAL_MS);

    req.on("close", () => {
      closed = true;
      clearInterval(ping);
      tail.close();
    });
    res.on("error", () => {}); // never let a dead socket throw out of the handler
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;

      const q = (name) => url.searchParams.get(name);
      if (p === "/api/city" && (req.method === "GET" || req.method === "HEAD")) {
        if (q("ref")) json(res, 200, getRefCity(q("ref"), q("base")));
        else json(res, 200, await getCity(q("rescan") === "1"));
        return;
      }
      if (p === "/api/deps" && req.method === "GET") {
        json(res, 200, await getDeps());
        return;
      }
      if (p === "/api/branches" && req.method === "GET") {
        json(res, 200, listBranches(repo));
        return;
      }
      if (p === "/api/diff" && req.method === "GET") {
        json(res, 200, { base: q("base"), head: q("head"), files: diffFiles(repo, q("base"), q("head")) });
        return;
      }
      if (p === "/api/diff/file" && req.method === "GET") {
        json(res, 200, fileDiff(repo, q("base"), q("head"), q("path")));
        return;
      }
      if (p === "/api/events" && req.method === "GET") {
        await handleEvents(req, res);
        return;
      }
      if (p === "/api/zones" && req.method === "GET") {
        await handleGetZones(res);
        return;
      }
      if (p === "/api/zones" && req.method === "PUT") {
        handlePutZones(req, res);
        return;
      }
      if (p === "/api/scope" && req.method === "GET") {
        json(res, 200, await loadScope());
        return;
      }
      if (p === "/api/scope" && req.method === "PUT") {
        handlePutList(req, res, scopePath, "allow", loadScope);
        return;
      }
      if (p.startsWith("/api/")) {
        json(res, 404, { error: `unknown endpoint ${req.method} ${p}` });
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: `method not allowed: ${req.method}` });
        return;
      }
      await serveStatic(res, url, webRoot);
    } catch (err) {
      // Validation errors from git.mjs carry status 400; anything else is a server error.
      if (!res.headersSent) json(res, err.status ?? 500, { error: err.message });
      else res.end();
    }
  });

  return server;
}

// CLI entry: node server/server.mjs --repo <path> [--port 4477]
function sameFile(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}
const isMain = !!process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  let repo = null;
  let port = 4477;
  let watchFiles = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo") repo = args[++i];
    else if (args[i] === "--port") port = Number(args[++i]);
    else if (args[i] === "--no-watch") watchFiles = false;
  }
  if (!repo || !Number.isInteger(port) || port <= 0) {
    console.error("usage: node server/server.mjs --repo <path> [--port 4477] [--no-watch]");
    process.exit(1);
  }
  const server = createServer({ repo, logFile: resolveLogFile(), zonesFile: resolveZonesFile() });
  // Changes made by agents without hooks (or by hand) still show up, as unattributed writes.
  if (watchFiles) startWatcher({ repo, logFile: resolveLogFile() });
  server.listen(port, "127.0.0.1", () => {
    console.log(`codecity: http://127.0.0.1:${port} (repo ${path.resolve(repo)})`);
  });
}
