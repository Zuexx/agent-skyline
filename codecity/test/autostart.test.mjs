import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookSettings } from "../cli/install-hooks.mjs";
import { probe } from "../lib/autostart.mjs";
import { rootKey } from "../lib/normalize.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(here, "..", "hooks", "session-start.mjs");

test("autostart is off unless asked for, and carries its options", () => {
  assert.equal(hookSettings().hooks.SessionStart, undefined);
  const cmd = hookSettings({ autostart: true, open: true, port: 4500 }).hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /session-start\.mjs" --port 4500 --open$/);
  assert.doesNotMatch(hookSettings({ autostart: true }).hooks.SessionStart[0].hooks[0].command, /--open/);
});

async function gitRepo(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-auto-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(path.join(dir, "a.txt"), "a\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

// Two consecutive ports nobody listens on, away from the usual 4477.
async function freePorts() {
  for (let i = 0; i < 50; i++) {
    const base = 20000 + Math.floor(Math.random() * 20000);
    if (!(await probe(base, 300)).up && !(await probe(base + 1, 300)).up) return base;
  }
  throw new Error("no free ports");
}

const runHook = (repo, port, env) =>
  execFileSync(process.execPath, [hookPath, "--port", String(port)], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: repo }),
    env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: repo },
    encoding: "utf8",
  });

test("the session-start hook starts one server per repo and reuses it", { timeout: 60_000 }, async (t) => {
  const repoA = await gitRepo(t);
  const repoB = await gitRepo(t);
  const work = await mkdtemp(path.join(os.tmpdir(), "codecity-auto-data-"));
  const serversDir = path.join(work, "servers");
  const env = { CODECITY_SERVERS: serversDir, CODECITY_EVENTS: path.join(work, "events.jsonl"), CODECITY_ZONES: path.join(work, "zones.json") };
  // Stop what the hook started, by the PIDs it recorded.
  t.after(async () => {
    for (const f of await readdir(serversDir).catch(() => [])) {
      const { pid } = JSON.parse(await readFile(path.join(serversDir, f), "utf8"));
      try {
        process.kill(pid);
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
    await rm(work, { recursive: true, force: true });
  });
  const base = await freePorts();

  assert.equal(runHook(repoA, base, env), ""); // nothing on stdout: it would land in Claude's context
  const a = await probe(base);
  assert.equal(rootKey(a.health?.repoPath ?? ""), rootKey(repoA));

  runHook(repoA, base, env); // same repo again: reused, not a second server
  assert.equal((await probe(base + 1)).up, false);
  assert.deepEqual(await readdir(serversDir), [`${base}.json`]);

  runHook(repoB, base, env); // another repo: the next free port
  assert.equal(rootKey((await probe(base + 1)).health?.repoPath ?? ""), rootKey(repoB));
  assert.equal((await readdir(serversDir)).length, 2);
});
