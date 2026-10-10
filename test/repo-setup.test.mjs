import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasHooks, hookSettings, mergeHooks, removeHooks } from "../lib/hookConfig.mjs";
import { ensureGitignored, projectRoot, removeRepoHooks, repoRoot, writeRepoHooks } from "../lib/repoSetup.mjs";

const other = { matcher: "Bash", hooks: [{ type: "command", command: "node my-own-hook.mjs" }] };

test("merge keeps other hooks and settings, and does not duplicate on a second merge", () => {
  const ours = hookSettings({ autostart: true });
  const once = mergeHooks({ permissions: { allow: ["x"] }, hooks: { PreToolUse: [other] } }, ours);
  const twice = mergeHooks(once, ours);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.permissions, { allow: ["x"] });
  assert.equal(once.hooks.PreToolUse.length, 2);
  assert.deepEqual(once.hooks.PreToolUse[0], other);
  assert.ok(hasHooks(once, ours));
  assert.ok(!hasHooks(once, hookSettings()));
});

test("merge replaces a stale install path", () => {
  const stale = { hooks: { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: 'node "C:/old/place/hooks/log-event.mjs"' }] }] } };
  const merged = mergeHooks(stale, hookSettings());
  assert.equal(merged.hooks.PostToolUse.length, 1);
  assert.doesNotMatch(merged.hooks.PostToolUse[0].hooks[0].command, /old\/place/);
});

test("remove takes out only Agent Skyline's hooks", () => {
  const merged = mergeHooks({ hooks: { PreToolUse: [other] } }, hookSettings({ autostart: true }));
  assert.deepEqual(removeHooks(merged), { hooks: { PreToolUse: [other] } });
  assert.deepEqual(removeHooks(mergeHooks({}, hookSettings())), {});
});

async function gitRepo(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // Ignore the machine's global ignore file, which may already cover settings.local.json.
  execFileSync("git", ["config", "core.excludesFile", path.join(dir, "no-such-file")], { cwd: dir });
  return dir;
}

test("repo setup writes, reports no change on a rerun, and cleans up", async (t) => {
  const repo = await gitRepo(t);
  await mkdir(path.join(repo, "sub"));
  assert.equal(repoRoot(path.join(repo, "sub")), repoRoot(repo));

  const ours = hookSettings({ autostart: true });
  const first = await writeRepoHooks(repo, ours);
  assert.ok(first.changed);
  assert.equal((await writeRepoHooks(repo, ours)).changed, false);

  assert.equal(await ensureGitignored(repo), true);
  assert.equal(await ensureGitignored(repo), false);
  assert.equal(spawnSync("git", ["check-ignore", "-q", ".claude/settings.local.json"], { cwd: repo }).status, 0);

  assert.ok((await removeRepoHooks(repo)).changed);
  assert.ok(!existsSync(first.file));
  assert.equal((await removeRepoHooks(repo)).changed, false);
});

test("a broken settings file is left untouched", async (t) => {
  const repo = await gitRepo(t);
  const file = path.join(repo, ".claude", "settings.local.json");
  await mkdir(path.dirname(file));
  await writeFile(file, "{ not json");
  await assert.rejects(writeRepoHooks(repo, hookSettings()), /not a JSON object/);
  assert.equal(await readFile(file, "utf8"), "{ not json");
});

test("a non-repo folder has no root", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-norepo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(repoRoot(dir), null);
});

test("a non-repo folder is connected as itself, with no .gitignore written", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-norepo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(projectRoot(dir), path.resolve(dir));
  assert.equal(await ensureGitignored(dir), false);
  assert.equal(existsSync(path.join(dir, ".gitignore")), false);
});
