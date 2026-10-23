// Theme packs (specs/06-themes.md): folders holding a theme.json plus images, fonts and sounds.
// Built-in packs ship in web/public/themes/; the user's own live in ~/.agent-skyline/themes/ and
// win over a built-in pack with the same id. A pack is data only: nothing in it is ever executed,
// and only the file types below are served from it.

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { manifestErrors } from "../lib/themeManifest.mjs";

export const builtinThemesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "themes");

// AGENT_SKYLINE_THEMES overrides where the user's packs live.
export function userThemesDir() {
  const v = process.env.AGENT_SKYLINE_THEMES;
  return typeof v === "string" && v.length > 0 ? v : path.join(os.homedir(), ".agent-skyline", "themes");
}

export const PACK_TYPES = {
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ogg": "audio/ogg",
};

const MAX_MANIFEST = 64 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
async function readPack(dir, id, source) {
  try {
    const file = path.join(dir, id, "theme.json");
    const s = await stat(file);
    if (s.size > MAX_MANIFEST) return { id, source, ok: false, error: "theme.json is larger than 64 KB" };
    const json = JSON.parse(await readFile(file, "utf8"));
    const errors = manifestErrors(json, id);
    const info = { id, source, name: json?.name ?? id, version: json?.version ?? null, renderer: json?.renderer ?? null, variants: Object.keys(json?.variants ?? {}) };
    return errors.length ? { ...info, ok: false, error: errors.join("; ") } : { ...info, ok: true };
  } catch (err) {
    return { id, source, ok: false, error: err.code === "ENOENT" ? "theme.json is missing" : err.message };
  }
}

async function packIds(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && ID.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Every pack, user packs replacing built-in ones of the same id, sorted by id. */
export async function listThemes({ builtin = builtinThemesDir, user = userThemesDir() } = {}) {
  const byId = new Map();
  for (const id of await packIds(builtin)) byId.set(id, await readPack(builtin, id, "builtin"));
  for (const id of await packIds(user)) byId.set(id, await readPack(user, id, "user"));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The file on disk for `/themes/<id>/<rest>`, or null when it must not be served: an unknown or
 * malformed id, a path leaving the pack folder (including through a link), or a file type packs
 * may not hold. The user's pack wins when both have the id.
 */
export async function resolveThemeFile(id, rest, { builtin = builtinThemesDir, user = userThemesDir() } = {}) {
  if (!ID.test(id) || typeof rest !== "string" || !rest) return null;
  const parts = rest.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || s.includes("\\") || s.includes(":"))) return null;
  if (!PACK_TYPES[path.extname(rest).toLowerCase()]) return null;
  for (const base of [user, builtin]) {
    const packDir = path.join(base, id);
    let realPack;
    try {
      realPack = await realpath(packDir);
    } catch {
      continue; // no pack with this id here; try the built-in ones
    }
    // The pack that has the id answers alone: a user pack never borrows built-in files.
    try {
      const real = await realpath(path.join(packDir, ...parts));
      if (!real.startsWith(realPack + path.sep)) return null;
      return (await stat(real)).isFile() ? real : null;
    } catch {
      return null;
    }
  }
  return null;
}
