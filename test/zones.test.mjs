import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadZones, decide } from "../lib/zones.mjs";

async function withTempFile(content, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-zones-"));
  try {
    const file = path.join(dir, "zones.json");
    if (content !== null) await writeFile(file, content, "utf8");
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const OK_ZONES = { status: "ok", locked: ["api/Anvil/**", "openspec/specs/**", "*.lock"] };

test("loadZones returns missing for a file that does not exist", async () => {
  const result = await withTempFile(null, (file) => loadZones(file));
  assert.deepEqual(result, { status: "missing" });
});

test("loadZones returns invalid for unreadable or non-JSON content", async () => {
  const badJson = await withTempFile("{ not json ", (file) => loadZones(file));
  assert.equal(badJson.status, "invalid");
  assert.match(badJson.error, /not valid JSON/);

  // A directory is unreadable as a file.
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-zones-"));
  try {
    const asDir = await loadZones(dir);
    assert.equal(asDir.status, "invalid");
    assert.ok(typeof asDir.error === "string" && asDir.error.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadZones returns invalid when locked is not an array of strings", async () => {
  for (const content of ['{"locked": "api/**"}', '{"locked": [1]}', '[]', '"hello"']) {
    const result = await withTempFile(content, (file) => loadZones(file));
    assert.equal(result.status, "invalid", `content: ${content}`);
    assert.match(result.error, /array of strings/);
  }
});

test("loadZones returns ok with the locked globs", async () => {
  const result = await withTempFile('{"locked": ["api/Anvil/**", "*.lock"]}', (file) => loadZones(file));
  assert.deepEqual(result, { status: "ok", locked: ["api/Anvil/**", "*.lock"] });
});

test("decide allows non-write events even inside a zone", () => {
  for (const kind of ["read", "search", "exec", "other"]) {
    const result = decide({ kind, paths: ["api/Anvil/Data/x.cs"] }, OK_ZONES);
    assert.deepEqual(result, { allow: true }, `kind ${kind}`);
  }
});

test("decide allows a write outside every zone", () => {
  for (const p of ["app/src/main.tsx", "docs/notes.md", "README.md"]) {
    const result = decide({ kind: "write", paths: [p] }, OK_ZONES);
    assert.deepEqual(result, { allow: true }, `path ${p}`);
  }
});

test("decide denies a write inside a zone with the reason, path and zone", () => {
  const result = decide({ kind: "write", paths: ["api/Anvil/Data/UnitOfWork.cs"] }, OK_ZONES);
  assert.equal(result.allow, false);
  assert.equal(result.path, "api/Anvil/Data/UnitOfWork.cs");
  assert.equal(result.zone, "api/Anvil/**");
  assert.equal(result.reason, 'agent-skyline: api/Anvil/Data/UnitOfWork.cs is in locked zone "api/Anvil/**"');

  const lock = decide({ kind: "write", paths: ["yarn.lock"] }, OK_ZONES);
  assert.equal(lock.allow, false);
  assert.equal(lock.zone, "*.lock");
});

test("decide allows a write when the zones config is missing", () => {
  const result = decide({ kind: "write", paths: ["api/Anvil/x.cs"] }, { status: "missing" });
  assert.deepEqual(result, { allow: true });
});

test("decide denies every write when the zones config is invalid (fail closed)", () => {
  const zones = { status: "invalid", error: "not valid JSON: boom" };
  const result = decide({ kind: "write", paths: ["app/src/main.tsx"] }, zones);
  assert.equal(result.allow, false);
  assert.equal(result.reason, "agent-skyline: zones.json is invalid (not valid JSON: boom); fix it or delete it");

  // A write with no resolvable path is still denied.
  const noPath = decide({ kind: "write", paths: [] }, zones);
  assert.equal(noPath.allow, false);
  assert.match(noPath.reason, /zones\.json is invalid/);

  // Non-write events are unaffected by an invalid config.
  assert.deepEqual(decide({ kind: "read", paths: ["app/src/main.tsx"] }, zones), { allow: true });
});

test("decideCommand blocks shell writes into a locked zone, resolving cwd and Git Bash paths", async () => {
  const { decideCommand, commandTargetsInRepo } = await import("../lib/zones.mjs");
  const zones = { status: "ok", locked: ["locked/**", "api/Anvil/**"] };
  const root = "D:\\Labs\\repo";
  assert.equal(decideCommand("echo x > locked/secret.ts", root, root, zones).allow, false);
  assert.equal(decideCommand("cd api && sed -i s/a/b/ Anvil/x.cs", root, root, zones).allow, false);
  assert.equal(decideCommand("echo x > Anvil/x.cs", "D:\\Labs\\repo\\api", root, zones).allow, false); // session cwd in a subfolder
  assert.equal(decideCommand("cp a.ts /d/Labs/repo/locked/a.ts", root, root, zones).allow, false);
  assert.equal(decideCommand("cat locked/secret.ts", root, root, zones).allow, true); // reading is fine
  assert.equal(decideCommand("echo x > src/a.ts", root, root, zones).allow, true);
  assert.deepEqual(commandTargetsInRepo("echo x > /tmp/outside.txt", root, root), []);
  const d = decideCommand("echo x > locked/secret.ts", root, root, zones);
  assert.match(d.reason, /this command would modify locked\/secret\.ts/);
});
