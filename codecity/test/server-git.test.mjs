import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server/server.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function start(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-srvgit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  await writeFile(path.join(dir, "keep.txt"), "k\n");
  await writeFile(path.join(dir, "gone.md"), "# gone\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "fix/thing");
  await writeFile(path.join(dir, "new.ts"), "a\nb\n");
  await unlink(path.join(dir, "gone.md"));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fix");
  git(dir, "checkout", "-q", "main");

  const server = createServer({
    repo: dir,
    logFile: path.join(dir, "events.jsonl"),
    zonesFile: path.join(dir, "zones.json"),
    webRoot: path.join(dir, "no-web-dist"),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

const get = async (url) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

test("branch, diff and ref-city endpoints", async (t) => {
  const base = await start(t);

  const branches = await get(`${base}/api/branches`);
  assert.deepEqual(branches.body, { current: "main", branches: ["fix/thing", "main"] });

  const diff = await get(`${base}/api/diff?base=main&head=fix/thing`);
  assert.deepEqual(
    diff.body.files.map((f) => [f.path, f.status]),
    [["gone.md", "D"], ["new.ts", "A"]]
  );

  // The branch's city has its new file, and keeps the deleted file as a building.
  const city = await get(`${base}/api/city?ref=fix/thing&base=main`);
  assert.deepEqual(city.body.buildings.map((b) => b.path).sort(), ["gone.md", "keep.txt", "new.ts"]);

  const fd = await get(`${base}/api/diff/file?base=main&head=fix/thing&path=new.ts`);
  assert.match(fd.body.text, /^\+b$/m);
});

test("the working-tree city carries the absolute repo path for editor links", async (t) => {
  const base = await start(t);
  const city = await get(`${base}/api/city`);
  assert.match(city.body.repoPath, /codecity-srvgit-/);
  assert.ok(!city.body.repoPath.includes("\\"));
  assert.ok(path.isAbsolute(city.body.repoPath));
});

test("churn counts recent commits per file on HEAD", async (t) => {
  const base = await start(t);
  const c = await get(`${base}/api/churn`);
  // main has one commit touching keep.txt and gone.md; the branch's commit is not on HEAD.
  assert.deepEqual(c.body, { days: 90, commits: { "gone.md": 1, "keep.txt": 1 } });
});

test("refs that could be read as git options are rejected with 400", async (t) => {
  const base = await start(t);
  for (const url of [
    `/api/diff?base=--output=x&head=main`,
    `/api/city?ref=-p`,
    `/api/diff/file?base=main&head=fix/thing&path=--output=x`,
  ]) {
    const r = await get(base + url);
    assert.equal(r.status, 400, url);
  }
});

test("the event stream only carries this repo's events", async (t) => {
  const { rootKey } = await import("../lib/normalize.mjs");
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-root-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  const logFile = path.join(dir, "events.jsonl");
  const line = (o) => JSON.stringify({ ts: "2026-10-09T00:00:00.000Z", kind: "read", paths: ["README.md"], ...o });
  await writeFile(
    logFile,
    [line({ n: 1, root: rootKey(dir) }), line({ n: 2, root: "e:/somewhere/else" }), line({ n: 3 })].join("\n") + "\n"
  );
  const server = createServer({ repo: dir, logFile, zonesFile: path.join(dir, "z.json"), webRoot: path.join(dir, "x") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));

  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, { signal: ac.signal });
  const reader = res.body.getReader();
  let buf = "";
  while (!buf.includes('"n":3')) buf += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  assert.match(buf, /"n":1/); // this repo
  assert.doesNotMatch(buf, /"n":2/); // another repo
  assert.match(buf, /"n":3/); // legacy event without a root
});
