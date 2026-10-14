// `skyline off` must undo everything `skyline` did, so nothing keeps running git (and, on Windows,
// flashing console windows) after the user turned Agent Skyline off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listServers, probe, stopRepoServers, stopServer, withinRepo } from "../lib/autostart.mjs";
import { autostartConfigured, settingsFiles } from "../lib/connected.mjs";
import { disconnectRepo } from "../lib/disconnect.mjs";
import { hookSettings } from "../lib/hookConfig.mjs";
import { ensureGitignored, removeGitignored, repoRoot, writeRepoHooks } from "../lib/repoSetup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionStart = path.join(here, "..", "hooks", "session-start.mjs");

async function tempDir(t, prefix = "agent-skyline-off-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function gitRepo(t) {
  const dir = await tempDir(t);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // No global ignore file (one may already ignore settings.local.json on the machine running the tests).
  execFileSync("git", ["config", "core.excludesFile", path.join(dir, ".no-global-ignore")], { cwd: dir });
  return dir;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A stand-in for server/server.mjs: answers /api/health as Agent Skyline for `repo`, taking
// `delayMs` of blocked event loop per request (like a synchronous git call in a big repo).
const FAKE = `
import http from "node:http";
const [repoPath, delayMs] = [process.argv[2], Number(process.argv[3])];
const server = http.createServer((req, res) => {
  const until = Date.now() + delayMs;
  while (Date.now() < until) {}
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ app: "agent-skyline", repoPath, pid: process.pid }));
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

async function fakeServer(t, repo, delayMs = 0) {
  const dir = await tempDir(t, "agent-skyline-fake-");
  const script = path.join(dir, "fake.mjs");
  await writeFile(script, FAKE);
  const child = spawn(process.execPath, [script, repo, String(delayMs)], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => {
    if (alive(child.pid)) child.kill("SIGKILL");
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once("data", (d) => resolve(Number(String(d).trim())));
    child.once("exit", () => reject(new Error("fake server exited")));
  });
  return { pid: child.pid, port };
}

async function record(serversDir, { pid, port }, repo) {
  await mkdir(serversDir, { recursive: true });
  const file = path.join(serversDir, `${port}.json`);
  await writeFile(file, JSON.stringify({ pid, port, repo }));
  return { file, pid, port, repo };
}

test("stopServer stops a busy server instead of dropping its record and leaving it running", { timeout: 30_000 }, async (t) => {
  const repo = await tempDir(t);
  const serversDir = path.join(await tempDir(t), "servers");
  const server = await fakeServer(t, repo, 1200); // slower than the old 600 ms probe
  const rec = await record(serversDir, server, repo);

  assert.equal(await stopServer(rec), "stopped");
  assert.equal(alive(server.pid), false);
  assert.equal(existsSync(rec.file), false);
});

test("stopServer keeps the record of a server it could not reach, so a second `skyline off` still finds it", { timeout: 30_000 }, async (t) => {
  const repo = await tempDir(t);
  const serversDir = path.join(await tempDir(t), "servers");
  const server = await fakeServer(t, repo, 1500);
  const rec = await record(serversDir, server, repo);

  const result = await stopServer(rec, { timeoutMs: 200, tries: 2 });
  assert.notEqual(result, "gone");
  assert.match(result, /did not answer/);
  assert.equal(existsSync(rec.file), true);
  assert.equal(alive(server.pid), true);
});

test("stopRepoServers stops an unrecorded server for the repo and one for a subfolder, and leaves other repos alone", { timeout: 30_000 }, async (t) => {
  const repo = await tempDir(t);
  const otherRepo = await tempDir(t);
  const serversDir = path.join(await tempDir(t), "servers");
  const unrecorded = await fakeServer(t, repo); // started by hand, or its record overwritten
  const sub = await fakeServer(t, path.join(repo, "api")); // started by an older hook from a subfolder session
  await record(serversDir, sub, path.join(repo, "api"));
  const other = await fakeServer(t, otherRepo);

  const results = await stopRepoServers({ repo, serversDir, ports: [unrecorded.port, other.port] });
  assert.deepEqual(results.map((r) => r.result), ["stopped", "stopped"]);
  assert.equal(alive(unrecorded.pid), false);
  assert.equal(alive(sub.pid), false);
  assert.equal(alive(other.pid), true);
  assert.equal((await probe(other.port)).health?.pid, other.pid);
  assert.deepEqual(listServers(serversDir), []);
});

test("withinRepo matches the repo and folders inside it, not a sibling with the same prefix", () => {
  const repo = path.resolve("/w/app");
  assert.equal(withinRepo(repo, repo), true);
  assert.equal(withinRepo(path.join(repo, "api"), repo), true);
  assert.equal(withinRepo(repo + "/", repo), true);
  assert.equal(withinRepo(path.resolve("/w/app-2"), repo), false);
  assert.equal(withinRepo(path.resolve("/w"), repo), false);
  assert.equal(withinRepo(null, repo), false);
});

test("removeGitignored takes out exactly the lines ensureGitignored added", async (t) => {
  // A .gitignore the user had: restored byte for byte, lines added later kept.
  const repo = await gitRepo(t);
  const file = path.join(repo, ".gitignore");
  await writeFile(file, "node_modules/\n");
  assert.equal(await ensureGitignored(repo), true);
  assert.equal(await removeGitignored(repo), true);
  assert.equal(await readFile(file, "utf8"), "node_modules/\n");

  await ensureGitignored(repo);
  await writeFile(file, (await readFile(file, "utf8")) + "dist/\n");
  assert.equal(await removeGitignored(repo), true);
  assert.equal(await readFile(file, "utf8"), "node_modules/\ndist/\n");

  // A .gitignore skyline created: deleted again.
  const fresh = await gitRepo(t);
  await ensureGitignored(fresh);
  assert.equal(await removeGitignored(fresh), true);
  assert.equal(existsSync(path.join(fresh, ".gitignore")), false);

  // CRLF (an editor on Windows rewrote it) still matches; the user's own ignore line is left alone.
  const crlf = await gitRepo(t);
  await writeFile(path.join(crlf, ".gitignore"), "a\r\n\r\n# Agent Skyline hooks (local to this machine)\r\n.claude/settings.local.json\r\n");
  assert.equal(await removeGitignored(crlf), true);
  assert.equal(await readFile(path.join(crlf, ".gitignore"), "utf8"), "a\r\n");
  const own = await gitRepo(t);
  await writeFile(path.join(own, ".gitignore"), ".claude/settings.local.json\n");
  assert.equal(await removeGitignored(own), false);
  assert.equal(await readFile(path.join(own, ".gitignore"), "utf8"), ".claude/settings.local.json\n");
});

test("disconnectRepo removes the hooks, the .gitignore lines and the servers, and keeps the ignore while other settings remain", { timeout: 30_000 }, async (t) => {
  const repo = await gitRepo(t);
  const serversDir = path.join(await tempDir(t), "servers");
  await writeRepoHooks(repo, hookSettings({ autostart: true, root: repo }));
  await ensureGitignored(repo);
  const server = await fakeServer(t, repo, 1200);
  await record(serversDir, server, repo);

  const out = await disconnectRepo({ repo, serversDir, basePort: server.port, tries: 1, home: null });
  assert.equal(out.hooks.changed, true);
  assert.equal(existsSync(path.join(repo, ".claude")), false);
  assert.equal(out.ignore, true);
  assert.equal(existsSync(path.join(repo, ".gitignore")), false);
  assert.deepEqual(out.servers.map((s) => s.result), ["stopped"]);
  assert.equal(alive(server.pid), false);
  assert.deepEqual(await readdir(serversDir), []);

  // The user's own settings stay in settings.local.json, so the file must stay ignored.
  const kept = await gitRepo(t);
  await mkdir(path.join(kept, ".claude"));
  await writeFile(path.join(kept, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
  await writeRepoHooks(kept, hookSettings({ autostart: true }));
  await ensureGitignored(kept);
  const again = await disconnectRepo({ repo: kept, serversDir, basePort: 1, tries: 0, home: null });
  assert.equal(again.ignore, false);
  assert.match(await readFile(path.join(kept, ".gitignore"), "utf8"), /settings\.local\.json/);
});

test("autostartConfigured looks in the project's and the user's settings files", async (t) => {
  const repo = await tempDir(t);
  const home = await tempDir(t);
  const files = settingsFiles([repo], home);
  assert.equal(autostartConfigured(files), false);

  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify(hookSettings({ autostart: true })));
  assert.equal(autostartConfigured(files), true);
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify(hookSettings())); // no SessionStart
  assert.equal(autostartConfigured(files), false);

  await mkdir(path.join(repo, ".claude"), { recursive: true });
  await writeFile(path.join(repo, ".claude", "settings.json"), JSON.stringify(hookSettings({ autostart: true })));
  assert.equal(autostartConfigured(files), true);
  await writeFile(path.join(repo, ".claude", "settings.json"), "{ not json");
  assert.equal(autostartConfigured(files), true, "an unreadable file never switches autostart off");
});

test("a session opened before `skyline off` does not start a server from its stale SessionStart hook", { timeout: 60_000 }, async (t) => {
  const repo = await gitRepo(t);
  const work = await tempDir(t);
  const serversDir = path.join(work, "servers");
  const env = {
    ...process.env,
    HOME: work, // no ~/.claude/settings.json from the machine running the tests
    USERPROFILE: work,
    CLAUDE_PROJECT_DIR: repo,
    AGENT_SKYLINE_SERVERS: serversDir,
    AGENT_SKYLINE_EVENTS: path.join(work, "events.jsonl"),
    AGENT_SKYLINE_ZONES: path.join(work, "zones.json"),
  };
  t.after(async () => {
    for (const r of listServers(serversDir)) {
      try {
        process.kill(r.pid);
      } catch {}
    }
  });
  let port;
  for (let i = 0; i < 50 && port == null; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if (!(await probe(p, 300)).up) port = p;
  }
  // The hook command as Claude Code snapshotted it while the repo was connected; then `skyline off`.
  await writeRepoHooks(repo, hookSettings({ autostart: true, port, root: repo }));
  await disconnectRepo({ repo, serversDir, basePort: port, tries: 1, home: work });

  const out = execFileSync(process.execPath, [sessionStart, "--port", String(port), "--root", repo], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "clear", cwd: repo }),
    env,
    encoding: "utf8",
  });
  assert.equal(out, "");
  assert.equal((await probe(port)).up, false, "no server started after `skyline off`");
  assert.deepEqual(listServers(serversDir), []);
});

test("stopServer keeps the record of a live server that is not listening yet, and drops a stale one", { timeout: 30_000 }, async (t) => {
  const serversDir = path.join(await tempDir(t), "servers");
  // A process that is alive but listens nowhere: a server still booting (node startup, antivirus).
  const booting = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => {
    if (alive(booting.pid)) booting.kill("SIGKILL");
  });
  let port;
  for (let i = 0; i < 50 && port == null; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if (!(await probe(p, 300)).up) port = p;
  }
  await mkdir(serversDir, { recursive: true });
  const file = path.join(serversDir, `${port}.json`);
  const started = new Date().toISOString();
  await writeFile(file, JSON.stringify({ pid: booting.pid, port, repo: "/r", started }));

  const result = await stopServer({ file, pid: booting.pid, port, repo: "/r", started });
  assert.match(result, /not listening yet/);
  assert.equal(existsSync(file), true, "record kept: dropping it would orphan the server");
  assert.equal(alive(booting.pid), true, "an unverified PID is never killed");

  // Long after its start a live PID on a free port is a reused PID: the record goes.
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(await stopServer({ file, pid: booting.pid, port, repo: "/r", started: old }), "gone");
  assert.equal(existsSync(file), false);
  assert.equal(alive(booting.pid), true);
});

test("disconnectRepo also cleans subfolder settings.local.json, and lists hooks in files it does not own", { timeout: 30_000 }, async (t) => {
  const repo = await gitRepo(t);
  const home = await tempDir(t);
  const serversDir = path.join(await tempDir(t), "servers");
  const sub = path.join(repo, "api");
  const nested = path.join(repo, "vendor-repo"); // a nested git repo: its own connection
  const other = path.join(repo, "tools");
  for (const d of [sub, nested, other]) await mkdir(d, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: nested });

  await writeRepoHooks(repo, hookSettings({ autostart: true, root: repo }));
  await writeRepoHooks(sub, hookSettings({ autostart: true })); // install-hooks.mjs api --write, no --root
  await writeRepoHooks(nested, hookSettings({ autostart: true, root: nested }));
  const elsewhere = await tempDir(t);
  await writeRepoHooks(other, hookSettings({ root: elsewhere })); // reports to another repo
  // Pasted by hand: never edited, only listed.
  const shared = path.join(repo, ".claude", "settings.json");
  await writeFile(shared, JSON.stringify(hookSettings({ root: repo })));
  await mkdir(path.join(home, ".claude"), { recursive: true });
  const user = path.join(home, ".claude", "settings.json");
  const userText = JSON.stringify({ model: "x", ...hookSettings({ autostart: true }) });
  await writeFile(user, userText);

  const out = await disconnectRepo({ repo, serversDir, basePort: 1, tries: 0, home });
  assert.equal(out.hooks.changed, true);
  assert.deepEqual(out.subHooks.map((h) => h.file), [path.join(sub, ".claude", "settings.local.json")]);
  assert.equal(existsSync(path.join(sub, ".claude")), false);
  assert.equal(existsSync(path.join(nested, ".claude", "settings.local.json")), true, "a nested repo is left alone");
  assert.equal(existsSync(path.join(other, ".claude", "settings.local.json")), true, "hooks for another repo are left alone");
  assert.deepEqual(
    out.leftovers.map((l) => [l.file, l.events.sort()]),
    [
      [shared, ["PostToolUse", "PreToolUse", "Stop"]],
      [user, ["PostToolUse", "PreToolUse", "SessionStart", "Stop"]],
    ]
  );
  assert.equal(await readFile(user, "utf8"), userText, "the user's settings file is not touched");
  assert.ok(existsSync(shared));
});

test("autostartConfigured counts only SessionStart hooks for this repo", async (t) => {
  const repo = await tempDir(t);
  const otherRepo = await tempDir(t);
  const home = await tempDir(t);
  await mkdir(path.join(home, ".claude"), { recursive: true });
  const user = path.join(home, ".claude", "settings.json");
  const files = settingsFiles([repo], home);
  await writeFile(user, JSON.stringify(hookSettings({ autostart: true, root: otherRepo })));
  assert.equal(autostartConfigured(files, repo), false, "a hook for another repo does not keep this one connected");
  assert.equal(autostartConfigured(files, otherRepo), true);
  await writeFile(user, JSON.stringify(hookSettings({ autostart: true, root: "/w/a$b" }))); // --root-b64
  assert.equal(autostartConfigured(files, "/w/a$b"), true);
  await writeFile(user, JSON.stringify(hookSettings({ autostart: true }))); // no --root: every project
  assert.equal(autostartConfigured(files, repo), true);
});

test("`skyline off` stops the city, removes the hooks, lists leftovers and fails until they are gone", { timeout: 60_000 }, async (t) => {
  const repo = repoRoot(await gitRepo(t)); // the spelling `skyline` resolves (git top level, links resolved)
  const home = await tempDir(t);
  const serversDir = path.join(await tempDir(t), "servers");
  const cli = path.join(here, "..", "cli", "skyline.mjs");
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_SKYLINE_SERVERS: serversDir };
  await writeRepoHooks(repo, hookSettings({ autostart: true, root: repo }));
  const server = await fakeServer(t, repo, 1200); // busy, and unrecorded
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify(hookSettings({ autostart: true })));

  const run = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, "off", repo, "--port", String(server.port)], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  const first = await run();
  assert.match(first.out, /hooks removed from/);
  assert.match(first.out, new RegExp(`stopped the city on port ${server.port}`));
  assert.equal(alive(server.pid), false);
  assert.ok(first.out.includes(path.join(home, ".claude", "settings.json")), first.out);
  assert.equal(first.code, 1, "leftover hooks: not done yet");

  await rm(path.join(home, ".claude", "settings.json"));
  const second = await run();
  assert.equal(second.code, 0, second.out);
  assert.doesNotMatch(second.out, /still configured/);
});
