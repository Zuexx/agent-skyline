// Which repo a hook event belongs to. `skyline` connects the git work tree (git rev-parse
// --show-toplevel) and starts the server for it, but Claude Code tells the hooks its own project
// dir (CLAUDE_PROJECT_DIR / payload.cwd), which is a subfolder when the session was started in one,
// or another spelling of the same folder (symlink, junction). The server only shows events whose
// root equals its repo, so `skyline` writes the root it connected into the hook commands as
// `--root "<dir>"`, and the hooks record that root instead of the session's folder.

import { realpathSync } from "node:fs";
import path from "node:path";
import { normalize } from "./normalize.mjs";

/**
 * The value of `--root <dir>` in argv, or of `--root-b64 <base64url>` (what lib/hookConfig.mjs
 * writes when the path holds characters a shell would expand, like $ ` " %), or null.
 */
export function rootArg(argv) {
  const i = argv.indexOf("--root");
  const v = i >= 0 ? argv[i + 1] : null;
  if (typeof v === "string" && v.length > 0) return v;
  const j = argv.indexOf("--root-b64");
  const b = j >= 0 ? argv[j + 1] : null;
  if (typeof b !== "string" || !/^[A-Za-z0-9_-]+$/.test(b)) return null;
  const decoded = Buffer.from(b, "base64url").toString("utf8");
  return decoded.length > 0 ? decoded : null;
}

const isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:\//.test(p);

function real(dir) {
  try {
    return realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
}

// "/"-separated location of `dir` inside `root` ("" for root itself), or null when it is outside.
function offsetInside(dir, root) {
  const rel = path.relative(real(root), real(dir));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * The spellings of `root` that shell-command targets are checked against: `root` itself and, when
 * `cwd` is inside `root` only once links are resolved (cwd `<alias>/api` for root `<top>`), that
 * same folder as the session spells it (`<alias>`). Relative targets are joined to `cwd`, so they
 * come out in the session's spelling and would otherwise miss the root.
 */
export function rootSpellings(root, cwd) {
  const out = [root];
  if (typeof root !== "string" || !root || typeof cwd !== "string" || !cwd) return out;
  const offset = offsetInside(cwd, root);
  if (offset == null) return out;
  const segs = path.resolve(cwd).split(path.sep);
  const tail = offset ? offset.split("/") : [];
  if (tail.length >= segs.length) return out;
  const end = segs.slice(segs.length - tail.length);
  if (end.some((s, i) => s.toLowerCase() !== tail[i].toLowerCase())) return out; // a link deeper inside; not mapped
  let alias = segs.slice(0, segs.length - tail.length).join(path.sep) || path.sep;
  if (/^[A-Za-z]:$/.test(alias)) alias += path.sep; // a drive root

  if (path.resolve(alias).toLowerCase() !== path.resolve(root).toLowerCase()) out.push(alias);
  return out;
}

/**
 * normalize() for a hook: paths relative to, and `root` set to, the connected repo root when one
 * is given; otherwise the session's project dir, as before. A path that is not under the root as
 * written but is under the session's folder, which itself resolves to inside the root (another
 * spelling of it), is mapped into the root too.
 */
export function hookEvent(payload, now, { root = null, projectDir = null } = {}) {
  if (!root) return normalize(payload, now, projectDir);
  const event = normalize(payload, now, root);
  const base = projectDir || payload?.cwd;
  if (event.paths.length && isAbsolute(event.paths[0]) && typeof base === "string" && base) {
    const viaBase = normalize(payload, now, base).paths[0];
    const offset = viaBase && !isAbsolute(viaBase) ? offsetInside(base, root) : null;
    if (offset != null) event.paths = [offset ? `${offset}/${viaBase}` : viaBase];
  }
  return event;
}
