import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { notIgnored, startWatcher } from "../server/watch.mjs";
import { rootKey } from "../lib/normalize.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function repo(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-watch-"));
  const logDir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-watchlog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(logDir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(path.join(dir, ".gitignore"), "bin/\n*.log\n");
  await mkdir(path.join(dir, "src"));
  return { dir, logFile: path.join(logDir, "events.jsonl") };
}

async function events(logFile) {
  try {
    return (await readFile(logFile, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test("notIgnored drops git-ignored paths", async (t) => {
  const { dir } = await repo(t);
  assert.deepEqual(notIgnored(dir, ["src/a.ts", "bin/x.dll", "debug.log"]), ["src/a.ts"]);
  assert.deepEqual(notIgnored(dir, []), []);
});

test("the watcher logs a changed file as a watcher write, and skips ignored files", async (t) => {
  const { dir, logFile } = await repo(t);
  const w = startWatcher({ repo: dir, logFile, settleMs: 300 });
  t.after(() => w.close());
  await sleep(200);

  await writeFile(path.join(dir, "src", "a.ts"), "x\n");
  await mkdir(path.join(dir, "bin"));
  await writeFile(path.join(dir, "bin", "out.dll"), "y");

  let evs = [];
  for (let i = 0; i < 40 && !evs.length; i++) {
    await sleep(100);
    evs = await events(logFile);
  }
  await sleep(500); // give an ignored file the chance to (wrongly) show up
  evs = await events(logFile);
  assert.deepEqual(evs.map((e) => [e.source, e.kind, e.paths[0]]), [["watcher", "write", "src/a.ts"]]);
  assert.equal(evs[0].root, rootKey(dir));
});

test("touching a file without changing it (a read, an atime update) is not a write", async (t) => {
  const { dir, logFile } = await repo(t);
  const old = path.join(dir, "src", "old.ts");
  await writeFile(old, "old\n");
  const hourAgo = new Date(Date.now() - 3600_000);
  await utimes(old, hourAgo, hourAgo);
  const w = startWatcher({ repo: dir, logFile, settleMs: 300 });
  t.after(() => w.close());
  await sleep(200);

  // What a reader does on Windows: the access time moves, the content and mtime do not.
  await readFile(old);
  await utimes(old, new Date(), hourAgo);
  await writeFile(path.join(dir, "src", "new.ts"), "x\n");

  let evs = [];
  for (let i = 0; i < 40 && !evs.length; i++) {
    await sleep(100);
    evs = await events(logFile);
  }
  await sleep(500);
  evs = await events(logFile);
  assert.deepEqual(evs.map((e) => e.paths[0]), ["src/new.ts"]);
});

test("a write an agent's hook already logged is not logged again by the watcher", async (t) => {
  const { dir, logFile } = await repo(t);
  await writeFile(logFile, "");
  const w = startWatcher({ repo: dir, logFile, settleMs: 600 });
  t.after(() => w.close());
  await sleep(200);

  await writeFile(path.join(dir, "src", "b.ts"), "x\n");
  // The hook's event for the same file arrives shortly after the write, as PostToolUse would.
  const hook = { ts: new Date().toISOString(), kind: "write", paths: ["src/b.ts"], root: rootKey(dir), source: "claude-code" };
  await appendFile(logFile, JSON.stringify(hook) + "\n");

  await sleep(1500);
  const evs = await events(logFile);
  assert.deepEqual(evs.map((e) => e.source), ["claude-code"]);
});
