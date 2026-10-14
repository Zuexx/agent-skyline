// A Claude Code session started in a subfolder of the repo (or through another spelling of its
// path) must still reach the city `skyline` opened: the hooks report to the repo root written into
// their commands (--root), not to the session's folder. Without it the event's root is the
// subfolder, the server (which serves the git top level) filters it out, and the city stays still.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasHooks, hookSettings, isSkylineGroup, mergeHooks, removeHooks } from "../lib/hookConfig.mjs";
import { rootArg } from "../lib/hookRoot.mjs";
import { probe } from "../lib/autostart.mjs";
import { rootKey } from "../lib/normalize.mjs";
import { connectRepoHooks, repoRoot } from "../lib/repoSetup.mjs";
import { createServer } from "../server/server.mjs";

const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks");

function runHook(name, args, payload, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(hooksDir, name), ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
}

// A git repo with api/a.cs; returns the top level as git reports it (what `skyline` serves).
async function repoWithSubfolder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-root-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const top = path.join(dir, "repo");
  await mkdir(path.join(top, "api"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: top });
  await writeFile(path.join(top, "api", "a.cs"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd: top });
  return { dir, top: repoRoot(path.join(top, "api")), logFile: path.join(dir, "events.jsonl"), zonesFile: path.join(dir, "zones.json") };
}

const edit = (cwd, file) => ({ session_id: "s", cwd, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file } });
const lastEvent = async (logFile) => JSON.parse((await readFile(logFile, "utf8")).trim().split("\n").at(-1));

test("hookSettings puts --root on every hook command and still recognises them as ours", () => {
  const root = process.platform === "win32" ? "C:\\work\\My Repo" : "/work/My Repo";
  const s = hookSettings({ autostart: true, port: 4500, open: true, root });
  const commands = Object.values(s.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(commands.length, 4);
  const want = `--root "${path.resolve(root).replace(/\\/g, "/")}"`;
  for (const c of commands) assert.ok(c.endsWith(want), c);
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /session-start\.mjs" --port 4500 --open --root "/);
  for (const groups of Object.values(s.hooks)) for (const g of groups) assert.ok(isSkylineGroup(g));
  // An install from before --root is replaced (so `skyline` rewrites it), not kept next to it.
  const old = mergeHooks({}, hookSettings({ autostart: true }));
  assert.ok(!hasHooks(old, s));
  const merged = mergeHooks(old, s);
  assert.equal(merged.hooks.PostToolUse.length, 1);
  assert.ok(hasHooks(merged, s));
  assert.deepEqual(removeHooks(merged), {});
  assert.equal(hookSettings().hooks.PostToolUse[0].hooks[0].command.includes("--root"), false);
});

test("rootArg reads --root and ignores a missing value", () => {
  assert.equal(rootArg(["--port", "1", "--root", "C:/r"]), "C:/r");
  assert.equal(rootArg(["--root"]), null);
  assert.equal(rootArg([]), null);
});

test("log-event from a session in a subfolder records the repo root and repo-relative paths", async (t) => {
  const { top, logFile } = await repoWithSubfolder(t);
  const sub = path.join(top, "api");
  const env = { AGENT_SKYLINE_EVENTS: logFile, CLAUDE_PROJECT_DIR: sub };

  // Without --root (the old behaviour): the subfolder becomes the root, which no server serves.
  await runHook("log-event.mjs", [], edit(sub, path.join(sub, "a.cs")), env);
  let ev = await lastEvent(logFile);
  assert.equal(ev.root, rootKey(sub));
  assert.deepEqual(ev.paths, ["a.cs"]);

  const r = await runHook("log-event.mjs", ["--root", top], edit(sub, path.join(sub, "a.cs")), env);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  ev = await lastEvent(logFile);
  assert.equal(ev.root, rootKey(top));
  assert.deepEqual(ev.paths, ["api/a.cs"]);
});

test("log-event maps paths given through another spelling of the repo (a symlink) into the root", { skip: process.platform === "win32" && "symlinks need extra rights on Windows" }, async (t) => {
  const { dir, top, logFile } = await repoWithSubfolder(t);
  const link = path.join(dir, "alias");
  await symlink(top, link, "dir");
  const sub = path.join(link, "api");
  await runHook("log-event.mjs", ["--root", top], edit(sub, path.join(sub, "a.cs")), { AGENT_SKYLINE_EVENTS: logFile, CLAUDE_PROJECT_DIR: sub });
  const ev = await lastEvent(logFile);
  assert.equal(ev.root, rootKey(top));
  assert.deepEqual(ev.paths, ["api/a.cs"]);
});

test("the server for the repo root streams subfolder events only when the hook had --root", async (t) => {
  const { top, logFile, zonesFile, dir } = await repoWithSubfolder(t);
  const sub = path.join(top, "api");
  const env = { AGENT_SKYLINE_EVENTS: logFile, CLAUDE_PROJECT_DIR: sub };
  await runHook("log-event.mjs", [], { ...edit(sub, path.join(sub, "a.cs")), session_id: "without-root" }, env);
  await runHook("log-event.mjs", ["--root", top], { ...edit(sub, path.join(sub, "a.cs")), session_id: "with-root" }, env);

  const server = createServer({ repo: top, logFile, zonesFile, webRoot: path.join(dir, "no-web-dist") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  t.after(() => {
    controller.abort();
    server.closeAllConnections();
    server.close();
  });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 8000;
  // Replay is in log order, so once "with-root" is in, "without-root" would have been sent already.
  while (!buf.includes('"session":"with-root"') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes('"session":"with-root"'), "event from the subfolder session reaches the city");
  assert.ok(buf.includes('"paths":["api/a.cs"]'));
  assert.ok(!buf.includes('"session":"without-root"'), "without --root it is filtered out (the bug)");
});

test("guard from a subfolder session checks zones against repo-relative paths with --root", async (t) => {
  const { top, logFile, zonesFile } = await repoWithSubfolder(t);
  await writeFile(zonesFile, JSON.stringify({ locked: ["api/**"] }));
  const sub = path.join(top, "api");
  const env = { AGENT_SKYLINE_EVENTS: logFile, AGENT_SKYLINE_ZONES: zonesFile, CLAUDE_PROJECT_DIR: sub };
  const payload = { ...edit(sub, path.join(sub, "a.cs")), hook_event_name: "PreToolUse" };
  assert.equal((await runHook("guard.mjs", [], payload, env)).stdout, ""); // old: "a.cs" misses "api/**"
  assert.match((await runHook("guard.mjs", ["--root", top], payload, env)).stdout, /"permissionDecision":"deny"/);
  const shell = { ...payload, tool_name: "Bash", tool_input: { command: "echo hi > a.cs" } };
  assert.match((await runHook("guard.mjs", ["--root", top], shell, env)).stdout, /"permissionDecision":"deny"/);
});

async function freePorts() {
  for (let i = 0; i < 50; i++) {
    const base = 20000 + Math.floor(Math.random() * 20000);
    if (!(await probe(base, 300)).up && !(await probe(base + 1, 300)).up) return base;
  }
  throw new Error("no free ports");
}

test("session-start from a subfolder with --root reuses the repo's server instead of starting a second", { timeout: 60_000 }, async (t) => {
  const { top, dir } = await repoWithSubfolder(t);
  const serversDir = path.join(dir, "servers");
  t.after(async () => {
    for (const f of await readdir(serversDir).catch(() => [])) {
      try {
        process.kill(JSON.parse(await readFile(path.join(serversDir, f), "utf8")).pid);
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
  });
  const env = { AGENT_SKYLINE_SERVERS: serversDir, AGENT_SKYLINE_EVENTS: path.join(dir, "events.jsonl"), AGENT_SKYLINE_ZONES: path.join(dir, "zones.json") };
  const base = await freePorts();
  const sub = path.join(top, "api");
  await connectRepoHooks(top, { port: base }); // the hook only starts a server for a repo that is still connected

  await runHook("session-start.mjs", ["--port", String(base)],{ hook_event_name: "SessionStart", cwd: top }, { ...env, CLAUDE_PROJECT_DIR: top });
  assert.equal(rootKey((await probe(base)).health?.repoPath ?? ""), rootKey(top));

  await runHook("session-start.mjs", ["--port", String(base), "--root", top], { hook_event_name: "SessionStart", cwd: sub }, { ...env, CLAUDE_PROJECT_DIR: sub });
  assert.equal((await probe(base + 1)).up, false, "no second server for the subfolder");
  assert.deepEqual(await readdir(serversDir), [`${base}.json`]);
});

test("install-hooks.mjs <repo> writes --root <repo> into every hook command", async (t) => {
  const { top } = await repoWithSubfolder(t);
  const out = execFileSync(process.execPath, [path.join(hooksDir, "..", "cli", "install-hooks.mjs"), top, "--autostart"], { encoding: "utf8" });
  const commands = Object.values(JSON.parse(out).hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(commands.length, 4);
  for (const c of commands) assert.equal(rootArg(c.split(/\s+/).map((w) => w.replace(/^"|"$/g, ""))), path.resolve(top).replace(/\\/g, "/"), c);
});

test("what `skyline` writes (connectRepoHooks) reports every hook to the repo it connected", async (t) => {
  const { top } = await repoWithSubfolder(t);
  await connectRepoHooks(top, { port: 4500 });
  const settings = JSON.parse(await readFile(path.join(top, ".claude", "settings.local.json"), "utf8"));
  const commands = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(commands.length, 4);
  for (const c of commands) assert.ok(c.endsWith(` --root "${path.resolve(top).replace(/\\/g, "/")}"`), c);
  // cli/skyline.mjs cannot be run here (it builds the UI and opens a browser): it must write its hooks
  // through connectRepoHooks and nothing else.
  const cli = await readFile(path.join(hooksDir, "..", "cli", "skyline.mjs"), "utf8");
  assert.match(cli, /await connectRepoHooks\(repo, \{ port \}\)/);
  assert.doesNotMatch(cli, /writeRepoHooks|hookSettings/);
});

test("rootArg decodes --root-b64", () => {
  const dir = '/w/a $b `c` "d" 100% !e';
  assert.equal(rootArg(["--root-b64", Buffer.from(dir).toString("base64url")]), dir);
  assert.equal(rootArg(["--root-b64", "not base64!"]), null);
});

test("each shell-special character in the repo path switches the hook command to --root-b64", () => {
  for (const c of ['"', "$", "`", "%", "!", ...(process.platform === "win32" ? [] : ["\\"])]) {
    const root = path.resolve(`/w/a${c}b`);
    const command = hookSettings({ root }).hooks.PostToolUse[0].hooks[0].command;
    const m = / --root-b64 ([A-Za-z0-9_-]+)$/.exec(command);
    assert.ok(m, `${c}: ${command}`);
    assert.equal(rootArg(["--root-b64", m[1]]), root.replace(/\\/g, process.platform === "win32" ? "/" : "\\"));
  }
});

// The command Claude Code runs goes through a shell. A repo path with $ ` " % ! would be expanded
// (or cut short) inside "...", recording a root no server serves.
test("a repo path with shell characters survives the hook command run through sh", { skip: process.platform === "win32" && "needs sh; on Windows the encoding is checked by the rootArg test" }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-quote-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const top = path.join(dir, 'we$HOME `echo x` "q" 100% !b \\n');
  await mkdir(top, { recursive: true });
  const logFile = path.join(dir, "events.jsonl");
  const s = hookSettings({ root: top });
  const command = s.hooks.PostToolUse[0].hooks[0].command;
  assert.match(command, / --root-b64 [A-Za-z0-9_-]+$/);
  const run = (cmd) =>
    new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", cmd], { env: { ...process.env, AGENT_SKYLINE_EVENTS: logFile, CLAUDE_PROJECT_DIR: top }, stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", resolve);
      child.stdin.end(JSON.stringify(edit(top, path.join(top, "a.cs"))));
    });
  await run(command);
  const ev = await lastEvent(logFile);
  assert.equal(ev.root, rootKey(top));
  assert.deepEqual(ev.paths, ["a.cs"]);
  // A plain path keeps the readable form.
  assert.match(hookSettings({ root: "/work/My Repo" }).hooks.PostToolUse[0].hooks[0].command, / --root "\/work\/My Repo"$/);
});

test("guard blocks shell writes into a locked zone from a session in another spelling of the repo (symlink)", { skip: process.platform === "win32" && "symlinks need extra rights on Windows" }, async (t) => {
  const { dir, top, logFile, zonesFile } = await repoWithSubfolder(t);
  await writeFile(zonesFile, JSON.stringify({ locked: ["api/**"] }));
  const link = path.join(dir, "alias");
  await symlink(top, link, "dir");
  const sub = path.join(link, "api");
  const env = { AGENT_SKYLINE_EVENTS: logFile, AGENT_SKYLINE_ZONES: zonesFile, CLAUDE_PROJECT_DIR: sub };
  const shell = (command) => ({ session_id: "s", cwd: sub, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  const deny = /"permissionDecision":"deny"/;
  assert.match((await runHook("guard.mjs", ["--root", top], shell("echo hi > a.cs"), env)).stdout, deny);
  assert.match((await runHook("guard.mjs", ["--root", top], shell(`echo hi > "${path.join(sub, "a.cs")}"`), env)).stdout, deny);
  assert.match((await runHook("guard.mjs", ["--root", top], shell(`echo hi > "${path.join(top, "api", "a.cs")}"`), env)).stdout, deny);
  assert.equal((await runHook("guard.mjs", ["--root", top], shell("echo hi > ../b.txt"), env)).stdout, "");
});
