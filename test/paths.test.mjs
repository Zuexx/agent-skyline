import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareRepoData, repoDataDir, resolveLogFile, resolveZonesFile } from "../lib/paths.mjs";
import { decide, loadZones } from "../lib/zones.mjs";
import { rootKey } from "../lib/normalize.mjs";

// Per-repo data under a temporary data/ folder; the old shared files sit in its root.
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-paths-"));
  const saved = { ...process.env };
  delete process.env.AGENT_SKYLINE_EVENTS;
  delete process.env.AGENT_SKYLINE_ZONES;
  process.env.AGENT_SKYLINE_DATA = path.join(dir, "data", "repos");
  t.after(async () => {
    process.env = saved;
    await rm(dir, { recursive: true, force: true });
  });
  const repoA = path.join(dir, "work", "a");
  const repoB = path.join(dir, "work", "b");
  await mkdir(path.join(repoA, "api"), { recursive: true });
  await mkdir(repoB, { recursive: true });
  return { dir, legacy: path.join(dir, "data"), repoA, repoB };
}

test("two repos get separate files, so a zone locked in one does not lock the other", async (t) => {
  const { repoA, repoB } = await setup(t);
  await prepareRepoData(repoA);
  await prepareRepoData(repoB);
  assert.notEqual(resolveZonesFile(repoA), resolveZonesFile(repoB));
  assert.notEqual(resolveLogFile(repoA), resolveLogFile(repoB));
  await writeFile(resolveZonesFile(repoA), JSON.stringify({ locked: ["api/**"] }));
  const write = { kind: "write", paths: ["api/x.cs"] };
  assert.equal(decide(write, await loadZones(resolveZonesFile(repoA))).allow, false);
  assert.equal(decide(write, await loadZones(resolveZonesFile(repoB))).allow, true);
});

test("a session in a subfolder uses its repo's folder", async (t) => {
  const { repoA } = await setup(t);
  const dir = await prepareRepoData(repoA);
  assert.equal(repoDataDir(path.join(repoA, "api")), dir);
  assert.equal(resolveZonesFile(path.join(repoA, "api")), path.join(dir, "zones.json"));
});

test("first use carries over the shared zones, scope and this repo's events", async (t) => {
  const { legacy, repoA, repoB } = await setup(t);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, "zones.json"), JSON.stringify({ locked: ["secret/**"] }));
  await writeFile(path.join(legacy, "scope.json"), JSON.stringify({ allow: ["api/**"] }));
  const evA = { kind: "read", paths: ["api/x.cs"], root: rootKey(repoA) };
  const evB = { kind: "read", paths: ["b.txt"], root: rootKey(repoB) };
  await writeFile(path.join(legacy, "events.jsonl"), [evA, evB].map((e) => JSON.stringify(e)).join("\n") + "\n");

  const dir = await prepareRepoData(repoA);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "zones.json"), "utf8")), { locked: ["secret/**"] });
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "scope.json"), "utf8")), { allow: ["api/**"] });
  const lines = (await readFile(path.join(dir, "events.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [evA]);

  // Only once: later changes in the repo's own files are kept.
  await writeFile(path.join(dir, "zones.json"), JSON.stringify({ locked: [] }));
  await prepareRepoData(repoA);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "zones.json"), "utf8")), { locked: [] });
});

test("environment overrides still win and skip the data folder", async (t) => {
  const { dir, repoA } = await setup(t);
  process.env.AGENT_SKYLINE_EVENTS = path.join(dir, "e.jsonl");
  process.env.AGENT_SKYLINE_ZONES = path.join(dir, "z.json");
  assert.equal(resolveLogFile(repoA), path.join(dir, "e.jsonl"));
  assert.equal(resolveZonesFile(repoA), path.join(dir, "z.json"));
  assert.equal(await prepareRepoData(repoA), null);
});
