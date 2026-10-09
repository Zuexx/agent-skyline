import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDeps, joinRepo } from "../server/deps.mjs";

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
