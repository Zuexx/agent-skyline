import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server/server.mjs";

test("declared scope round-trips through /api/scope and zones still work", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-scope-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const server = createServer({
    repo: dir,
    logFile: path.join(dir, "e.jsonl"),
    zonesFile: path.join(dir, "data", "zones.json"),
    webRoot: path.join(dir, "none"),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (p, body) => fetch(base + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  assert.deepEqual(await (await fetch(base + "/api/scope")).json(), { allow: [] }); // nothing declared yet

  let r = await put("/api/scope", { allow: ["api/**", "docs/**"] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { allow: ["api/**", "docs/**"] });
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "data", "scope.json"), "utf8")), { allow: ["api/**", "docs/**"] });

  r = await put("/api/scope", { locked: ["x"] }); // wrong key
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /"allow" must be an array/);

  r = await put("/api/zones", { locked: ["app/**"] });
  assert.deepEqual(await r.json(), { status: "ok", locked: ["app/**"] });
});
