import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDeps, clauseNames, joinRepo, packDeps, readsFile } from "../server/deps.mjs";
import { refReader } from "../server/git.mjs";

async function repo(t, files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-deps-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), text);
  }
  return { dir, paths: Object.keys(files).sort() };
}

const sorted = (edges) => edges.map(([a, b]) => `${a} -> ${b}`).sort();

test("packDeps sends each path once and edges as index pairs", () => {
  const packed = packDeps({ edges: [["a.ts", "b.ts"], ["c.ts", "b.ts"]], truncated: false });
  assert.deepEqual(packed, { paths: ["a.ts", "b.ts", "c.ts"], edges: [0, 1, 2, 1], unused: [], truncated: false });
  assert.deepEqual(packDeps({ edges: [["a.ts", "b.ts", "unused"]], truncated: false }).unused, [0]);
});

test("clauseNames lists the local names an import binds", () => {
  assert.deepEqual(clauseNames("React, { useState as useS, type FC }"), ["useS", "FC", "React"]);
  assert.deepEqual(clauseNames("* as path"), ["path"]);
  assert.deepEqual(clauseNames("def"), ["def"]);
});

test("JS/TS: an import whose names are never used is marked unused, other forms are not", async (t) => {
  const { dir, paths } = await repo(t, {
    "src/lib.ts": "export const a = 1; export const b = 2; export type T = number;\n",
    "src/used.ts": 'import { a } from "./lib";\nconsole.log(a);\n',
    "src/leftover.ts": 'import { a, b } from "./lib";\n// a is only mentioned in this comment\nexport const x = 1;\n',
    "src/ns.ts": 'import * as lib from "./lib";\nexport const y = lib.a;\n',
    "src/typeonly.ts": 'import type { T } from "./lib";\nexport const z: T = 1;\n',
    "src/reexport.ts": 'export { a } from "./lib";\n',
    "src/side.ts": 'import "./lib";\n',
    "src/jsx.tsx": 'import { a as Thing } from "./lib";\nexport const v = <Thing />;\n',
    "src/commented.tsx": '// import { a } from "./lib"\n/* import { b } from "./lib" */\nexport const w = 1;\n',
  });
  const { edges } = buildDeps(dir, paths);
  const marks = Object.fromEntries(edges.map(([from, , flag]) => [from, flag ?? "used"]));
  assert.deepEqual(marks, {
    "src/used.ts": "used",
    "src/leftover.ts": "unused",
    "src/ns.ts": "used",
    "src/typeonly.ts": "used",
    "src/reexport.ts": "used",
    "src/side.ts": "used",
    "src/jsx.tsx": "used",
    // src/commented.tsx: a commented-out import is no edge at all
  });
});

test("joinRepo normalizes and refuses to leave the repo", () => {
  assert.equal(joinRepo("a/b", "../c/./d"), "a/c/d");
  assert.equal(joinRepo("", "../x"), null);
});

test("JS/TS: relative imports, index files, .js written for .ts, and tsconfig aliases", async (t) => {
  const { dir, paths } = await repo(t, {
    "app/tsconfig.json": `{
      // comments and trailing commas are allowed
      "compilerOptions": { "paths": { "@/*": ["./*"], }, },
    }`,
    "app/lib/util.ts": "export const x = 1;\n",
    "app/lib/index.ts": 'export * from "./util";\n',
    "app/page.tsx": 'import { x } from "@/lib";\nimport React from "react";\nimport "./styles.css";\n',
    "app/styles.css": "body {}\n",
    "server/a.mjs": 'import { b } from "./b.js";\nconst c = require("../app/lib/util");\n',
    "server/b.ts": "export const b = 2;\n",
  });
  const { edges } = buildDeps(dir, paths);
  assert.deepEqual(sorted(edges), [
    "app/lib/index.ts -> app/lib/util.ts",
    "app/page.tsx -> app/lib/index.ts",
    "app/page.tsx -> app/styles.css",
    "server/a.mjs -> app/lib/util.ts",
    "server/a.mjs -> server/b.ts",
  ]);
});

test("a branch's dependencies are read from git objects, not the working tree", async (t) => {
  const { dir } = await repo(t, { "src/a.ts": "export const a = 1;\n" });
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  await writeFile(path.join(dir, "src", "a.test.ts"), 'import { a } from "./a";\n');
  git("add", "-A");
  git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "-m", "test");
  git("checkout", "-q", "main"); // the working tree no longer has the test

  assert.deepEqual(buildDeps(dir, ["src/a.ts"]).edges, []);
  const { paths, read } = refReader(dir, "feature", readsFile);
  assert.deepEqual(sorted(buildDeps(dir, paths, read).edges), ["src/a.test.ts -> src/a.ts"]);
});

test("C#: a file uses types it names from namespaces it can see", async (t) => {
  const { dir, paths } = await repo(t, {
    "Api/Data/UnitOfWork.cs": "namespace Api.Data;\npublic sealed class UnitOfWork { }\n",
    "Api/Data/AppDb.cs": "namespace Api.Data;\npublic class AppDb { UnitOfWork? u; }\n",
    "Api/Services/Orders.cs":
      "using Api.Data;\nnamespace Api.Services;\n// mentions Other only in a comment\npublic class Orders(AppDb db) { }\n",
    "Other/Other.cs": "namespace Other { public record Other(); }\n",
    "Api.Tests/OrdersTests.cs": "using Api.Services;\nnamespace Api.Tests;\npublic class OrdersTests { Orders o; string s = \"AppDb\"; }\n",
  });
  const { edges } = buildDeps(dir, paths);
  assert.deepEqual(sorted(edges), [
    "Api.Tests/OrdersTests.cs -> Api/Services/Orders.cs",
    "Api/Data/AppDb.cs -> Api/Data/UnitOfWork.cs",
    "Api/Services/Orders.cs -> Api/Data/AppDb.cs",
  ]);
});
