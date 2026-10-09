import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isValidRef, listBranches, treeFiles, diffFiles, fileDiff } from "../server/git.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

// main: a.txt (2 lines), src/keep.ts, src/old.ts, gone.md
// feature: a.txt modified (+1 line), src/new.ts added, gone.md deleted, src/old.ts renamed to src/renamed.ts
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "a.txt"), "one\ntwo\n");
  await writeFile(path.join(dir, "src", "keep.ts"), "export const k = 1;\n");
  await writeFile(path.join(dir, "src", "old.ts"), "line1\nline2\nline3\nline4\nline5\n");
  await writeFile(path.join(dir, "gone.md"), "# gone\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  await writeFile(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
  await writeFile(path.join(dir, "src", "new.ts"), "a\nb\n");
  await unlink(path.join(dir, "gone.md"));
  git(dir, "mv", "src/old.ts", "src/renamed.ts");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feature");
  git(dir, "checkout", "-q", "main"); // compare without having the branch checked out
  return dir;
}

test("isValidRef rejects option look-alikes, ranges and odd characters", () => {
  for (const ok of ["main", "fix/api-error", "release-1.2", "feature_x"]) assert.ok(isValidRef(ok), ok);
  for (const bad of ["", "-x", "--output=/tmp/x", "main..feature", "a b", "a;b", "a$(x)", null]) {
    assert.ok(!isValidRef(bad), String(bad));
  }
});

test("listBranches lists local branches and the current one", async (t) => {
  const dir = await fixture(t);
  assert.deepEqual(listBranches(dir), { current: "main", branches: ["feature", "main"] });
});

test("treeFiles reads another branch's files and line counts without checking it out", async (t) => {
  const dir = await fixture(t);
  assert.deepEqual(treeFiles(dir, "feature"), [
    { path: "a.txt", lines: 3 },
    { path: "src/keep.ts", lines: 1 },
    { path: "src/new.ts", lines: 2 },
    { path: "src/renamed.ts", lines: 5 },
  ]);
  assert.throws(() => treeFiles(dir, "--all"), /invalid ref/);
});

test("diffFiles reports added, modified, deleted and renamed files with line counts", async (t) => {
  const dir = await fixture(t);
  assert.deepEqual(diffFiles(dir, "main", "feature"), [
    { path: "a.txt", status: "M", added: 1, removed: 0 },
    { path: "gone.md", status: "D", added: 0, removed: 1 },
    { path: "src/new.ts", status: "A", added: 2, removed: 0 },
    { path: "src/renamed.ts", status: "R", oldPath: "src/old.ts", added: 0, removed: 0 },
  ]);
});

test("fileDiff returns the unified diff of one file", async (t) => {
  const dir = await fixture(t);
  const { text, truncated } = fileDiff(dir, "main", "feature", "a.txt");
  assert.equal(truncated, false);
  assert.match(text, /^\+three$/m);
  assert.throws(() => fileDiff(dir, "main", "feature", "--output=x"), /invalid path/);
});
