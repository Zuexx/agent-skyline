// HTTP server: city endpoint + cache, zones round trip and validation, SSE replay/live
// events, static fallback and path traversal. Every test closes its server (and force-closes
// keep-alive sockets), aborts any open SSE stream, and removes its temp dir so node --test exits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server/server.mjs";

function git(dir, ...args) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

async function withTempDir(t, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-server-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return fn(dir);
}

// A minimal git repo: one root file (3 lines, no trailing newline) and one nested file.
async function makeRepo(dir) {
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q");
  await writeFile(path.join(repo, "README.md"), "# agent-skyline\nsecond line\nthird line no newline");
  await mkdir(path.join(repo, "src"));
  await writeFile(path.join(repo, "src/app.js"), "console.log('hi')\n");
  git(repo, "add", "-A"); // staged files are listed by `git ls-files` without a commit
  return repo;
}

async function startServer(t, dir) {
  const repo = await makeRepo(dir);
  const logFile = path.join(dir, "events.jsonl");
  const zonesFile = path.join(dir, "zones.json");
  // A web root that never exists, so the static-fallback test holds whether or not web/dist is built.
  const server = createServer({ repo, logFile, zonesFile, webRoot: path.join(dir, "no-web-dist") });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve); // port 0 -> ephemeral; loopback only
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections(); // undici keep-alive sockets would otherwise hold close() open
  }));
  return { base: `http://127.0.0.1:${server.address().port}`, repo, logFile, zonesFile };
}

test("GET /api/city returns the layout shape and caches until ?rescan=1", async (t) => {
  await withTempDir(t, async (dir) => {
    const { base, repo } = await startServer(t, dir);

    let res = await fetch(base + "/api/city");
    assert.equal(res.status, 200);
    const city = await res.json();
    assert.equal(city.repo, repo);
    assert.ok(typeof city.width === "number" && city.width > 0);
    assert.ok(typeof city.depth === "number" && city.depth > 0);
    assert.ok(Array.isArray(city.districts) && city.districts.length >= 1);
    const root = city.districts.find((d) => d.path === "");
    assert.ok(root, "root district present");
    assert.equal(root.depth, 0);

    assert.deepEqual(
      city.buildings.map((b) => b.path).sort(),
      ["README.md", "src/app.js"],
    );
    for (const b of city.buildings) {
      assert.ok(typeof b.x === "number" && typeof b.z === "number");
      assert.ok(Number.isInteger(b.lines) && b.lines > 0);
      assert.ok(b.height >= 0.3);
    }

    // A newly staged file must not appear until a rescan is requested (the result is cached).
    await writeFile(path.join(repo, "NEW.txt"), "x\ny\n");
    git(repo, "add", "-A");
    const cached = await (await fetch(base + "/api/city")).json();
    assert.equal(cached.buildings.length, 2);
    const rescanned = await (await fetch(base + "/api/city?rescan=1")).json();
    assert.equal(rescanned.buildings.length, 3);
  });
});

test("PUT /api/zones then GET round trip; invalid bodies get 400", async (t) => {
  await withTempDir(t, async (dir) => {
    const { base, zonesFile } = await startServer(t, dir);

    // No zones file yet: missing status, empty locked list.
    let res = await fetch(base + "/api/zones");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "missing", locked: [] });

    res = await fetch(base + "/api/zones", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locked: ["src/**"] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", locked: ["src/**"] });

    // The write landed on disk (atomic tmp+rename) and GET now reads it back.
    const onDisk = JSON.parse(await readFile(zonesFile, "utf8"));
    assert.deepEqual(onDisk.locked, ["src/**"]);
    res = await fetch(base + "/api/zones");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", locked: ["src/**"] });

    const badBodies = [
      "not json at all", // unparseable
      JSON.stringify({ locked: "nope" }), // not an array
      JSON.stringify({ locked: ["ok", ""] }), // empty string entry
      JSON.stringify({ locked: [1] }), // non-string entry
      JSON.stringify({ locked: Array.from({ length: 201 }, (_, i) => `z${i}`) }), // > 200 entries
      JSON.stringify({ locked: ["x".repeat(70 * 1024)] }), // valid shape but body > 64 KB
    ];
    for (const body of badBodies) {
      res = await fetch(base + "/api/zones", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 400, `expected 400 for ${body.slice(0, 40)}...`);
      const errBody = await res.json();
      assert.ok(typeof errBody.error === "string" && errBody.error.length > 0);
    }

    // Rejected writes must not have clobbered the good config.
    res = await fetch(base + "/api/zones");
    assert.deepEqual(await res.json(), { status: "ok", locked: ["src/**"] });
  });
});

test("GET /api/events replays existing events and streams appended ones as SSE", async (t) => {
  await withTempDir(t, async (dir) => {
    const { base, logFile } = await startServer(t, dir);
    await writeFile(logFile, '{"n":1}\n{"n":2}\n'); // history to replay on connect

    const controller = new AbortController();
    t.after(() => controller.abort()); // abort the SSE stream so nothing outlives the test
    const res = await fetch(base + "/api/events", { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("content-type")), /text\/event-stream/);
    assert.equal(res.headers.get("cache-control"), "no-cache");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let appended = false;

    async function collect() {
      for (;;) {
        // Once the replay is in flight, append a live event and wait for it to arrive.
        if (!appended && buf.includes('"n":2')) {
          await appendFile(logFile, '{"n":3}\n');
          appended = true;
        }
        if (buf.includes('"n":3')) return;
        const { value, done } = await reader.read(); // rejects once the controller aborts
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
    }

    const collected = collect();
    collected.catch(() => {}); // suppress a late rejection after the timeout already failed us
    const timeout = new Promise((_, reject) => {
      const to = setTimeout(() => {
        controller.abort();
        reject(new Error("timed out waiting for SSE events"));
      }, 8000);
      to.unref(); // must not keep node --test alive if the test already finished
    });
    timeout.catch(() => {}); // a late fire after an earlier failure must not become unhandled

    await Promise.race([collected, timeout]);

    assert.ok(buf.includes('data: {"n":1}\n\n'), "first existing event replayed");
    assert.ok(buf.includes('data: {"n":2}\n\n'), "second existing event replayed");
    assert.ok(buf.includes('data: {"n":3}\n\n'), "appended event streamed live");
  });
});

test("static fallback is 404 text and path traversal cannot escape web/dist", async (t) => {
  await withTempDir(t, async (dir) => {
    const { base } = await startServer(t, dir); // webRoot points at a folder that does not exist

    let res = await fetch(base + "/");
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "web UI not built");

    // Normalized traversal: the URL parser collapses /../ to /package.json, which stays inside
    // dist (absent here) -> plain fallback text, never the root package.json.
    res = await fetch(base + "/../package.json");
    const body = await res.text();
    assert.ok(!body.includes('"type"'), `traversal leaked package.json: ${body.slice(0, 80)}`);

    // Encoded traversal: the server must decode and reject the escape before serving anything.
    // `%2e%2e` would be collapsed by fetch's URL parser before it is sent; an encoded slash is
    // not, so this is the form that actually reaches the server's own check.
    res = await fetch(base + "/..%2f..%2fpackage.json");
    assert.equal(res.status, 403);
    const escaped = await res.json();
    assert.ok(typeof escaped.error === "string");

    // Unknown API endpoints get a JSON 404.
    res = await fetch(base + "/api/nope");
    assert.equal(res.status, 404);
    const unknown = await res.json();
    assert.ok(typeof unknown.error === "string");
  });
});
