import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRepo } from "../server/scan.mjs";

async function withTempRepo(t, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-scan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return fn(dir);
}

function linesOf(files, p) {
  const f = files.find((x) => x.path === p);
  assert.ok(f, `expected ${p} to be listed`);
  return f.lines;
}

test("scanRepo lists staged files with slash paths and counts lines", async (t) => {
  await withTempRepo(t, async (dir) => {
    // 3 lines, no trailing newline.
    await writeFile(path.join(dir, "no-newline.txt"), "a\nb\nc");
    await mkdir(path.join(dir, "sub"));
    // 2 lines, trailing newline.
    await writeFile(path.join(dir, "sub", "with-newline.txt"), "x\ny\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const result = scanRepo(dir);
    assert.equal(result.root, dir);
    assert.deepEqual(
      result.files.map((f) => f.path),
      ["no-newline.txt", "sub/with-newline.txt"], // sorted ascending, slash separators
    );
    assert.equal(linesOf(result.files, "no-newline.txt"), 3);
    assert.equal(linesOf(result.files, "sub/with-newline.txt"), 2);
  });
});

test("scanRepo includes new files before git add, but not ignored ones", async (t) => {
  await withTempRepo(t, async (dir) => {
    await writeFile(path.join(dir, ".gitignore"), "build/\n");
    await writeFile(path.join(dir, "tracked.md"), "t\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    // What an agent leaves behind: a new file nobody has added, and build output.
    await writeFile(path.join(dir, "new.ts"), "n\n");
    await mkdir(path.join(dir, "build"));
    await writeFile(path.join(dir, "build", "out.js"), "o\n");

    assert.deepEqual(
      scanRepo(dir).files.map((f) => f.path),
      [".gitignore", "new.ts", "tracked.md"]
    );
  });
});

test("scanRepo reports lines: 0 for binary and over-2MB files", async (t) => {
  await withTempRepo(t, async (dir) => {
    // \0 inside the first 8000 bytes -> binary.
    await writeFile(path.join(dir, "blob.bin"), Buffer.from([137, 80, 78, 71, 0, 13, 10]));
    // No \0 in the first 8000 bytes but one later: still text (probe is only 8000 bytes).
    await writeFile(path.join(dir, "late-null.txt"), "a".repeat(9000) + "\u0000b\n");
    // Over 2 MB -> lines: 0 without counting.
    await writeFile(path.join(dir, "big.log"), Buffer.alloc(2 * 1024 * 1024 + 1, 10));
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const files = scanRepo(dir).files;
    assert.equal(linesOf(files, "blob.bin"), 0);
    assert.equal(linesOf(files, "late-null.txt"), 1);
    assert.equal(linesOf(files, "big.log"), 0);
  });
});

test("scanRepo skips files that are staged but missing on disk", async (t) => {
  await withTempRepo(t, async (dir) => {
    await writeFile(path.join(dir, "ghost.txt"), "gone\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    await rm(path.join(dir, "ghost.txt"));

    const result = scanRepo(dir);
    assert.deepEqual(result.files, []);
  });
});

test("scanRepo counts an empty file as 0 lines", async (t) => {
  await withTempRepo(t, async (dir) => {
    await writeFile(path.join(dir, "empty.txt"), "");
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const result = scanRepo(dir);
    assert.deepEqual(result.files, [{ path: "empty.txt", lines: 0 }]);
  });
});
