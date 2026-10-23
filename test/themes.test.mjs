import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server/server.mjs";
import { builtinThemesDir, listThemes, resolveThemeFile } from "../server/themes.mjs";

const manifest = (id, extra = {}) => JSON.stringify({ id, name: id, version: 1, renderer: "blocks", variants: { night: { palette: { background: "#000" } } }, ...extra });

async function dirs(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-themes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const builtin = path.join(dir, "builtin");
  const user = path.join(dir, "user");
  for (const [base, id, json] of [
    [builtin, "blocks", manifest("blocks")],
    [builtin, "quest", manifest("quest")],
    [user, "quest", manifest("quest", { version: 2 })],
    [user, "broken", manifest("other")],
  ]) {
    await mkdir(path.join(base, id), { recursive: true });
    await writeFile(path.join(base, id, "theme.json"), json);
  }
  await writeFile(path.join(builtin, "quest", "atlas.png"), "png");
  await writeFile(path.join(user, "quest", "notes.js"), "alert(1)");
  await writeFile(path.join(dir, "secret.json"), "{}");
  return { dir, builtin, user };
}

test("lists packs, the user's replacing built-in ones, and says why a pack is broken", async (t) => {
  const d = await dirs(t);
  const list = await listThemes(d);
  assert.deepEqual(list.map((p) => [p.id, p.source, p.ok]), [["blocks", "builtin", true], ["broken", "user", false], ["quest", "user", true]]);
  assert.equal(list.find((p) => p.id === "quest").version, 2);
  assert.match(list.find((p) => p.id === "broken").error, /folder name/);
});

test("serves only pack data inside the pack folder", async (t) => {
  const d = await dirs(t);
  assert.equal(await resolveThemeFile("quest", "theme.json", d), path.join(d.user, "quest", "theme.json"));
  assert.equal(await resolveThemeFile("quest", "atlas.png", d), null, "a user pack does not borrow built-in files");
  assert.equal(await resolveThemeFile("blocks", "theme.json", d), path.join(d.builtin, "blocks", "theme.json"));
  assert.equal(await resolveThemeFile("quest", "notes.js", d), null, "not a pack file type");
  assert.equal(await resolveThemeFile("quest", "../../secret.json", d), null);
  assert.equal(await resolveThemeFile("..", "secret.json", d), null);
  assert.equal(await resolveThemeFile("quest", "a\..\..\secret.json", d), null);
  try {
    await symlink(path.join(d.dir, "secret.json"), path.join(d.user, "quest", "link.json"));
  } catch {
    return; // creating links needs extra rights on some Windows setups
  }
  assert.equal(await resolveThemeFile("quest", "link.json", d), null, "a link out of the pack is refused");
});

test("the built-in blocks pack is valid", async () => {
  const list = await listThemes({ builtin: builtinThemesDir, user: path.join(os.tmpdir(), "agent-skyline-no-such-dir") });
  assert.deepEqual(list.find((p) => p.id === "blocks"), { id: "blocks", source: "builtin", name: { en: "Blocks", "zh-TW": "方塊城市" }, version: 1, renderer: "blocks", variants: ["night", "day"], ok: true });
});

test("/api/themes and /themes/<id>/<file> over HTTP", async (t) => {
  const d = await dirs(t);
  execFileSync("git", ["init", "-q"], { cwd: d.dir });
  const server = createServer({ repo: d.dir, logFile: path.join(d.dir, "e.jsonl"), zonesFile: path.join(d.dir, "z.json"), webRoot: path.join(d.dir, "none"), themeDirs: d });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + "/api/themes")).json()).length, 3);
  const ok = await fetch(base + "/themes/quest/theme.json");
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /application\/json/);
  assert.equal((await ok.json()).version, 2);
  assert.equal((await fetch(base + "/themes/quest/notes.js")).status, 404);
  assert.equal((await fetch(base + "/themes/quest/%2e%2e/%2e%2e/secret.json")).status, 404);
});
