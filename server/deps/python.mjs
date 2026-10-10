// Python: `import a.b`, `from a.b import c` and relative `from .x import y` lead to a/b.py or
// a/b/__init__.py. Absolute imports are matched by path tail, so a `src/` layout or any other
// source root works without configuration; packages outside the repo match nothing.

import { dirOf, joinRepo } from "./common.mjs";

// Comments, docstrings and other string literals out, so `import` in text does not count.
const strip = (text) =>
  text.replace(/("""|''')[\s\S]*?\1|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*/g, " ");

/** [module as "a/b" or null, names imported from it, leading dots] per import statement. */
export function pyImports(text) {
  const src = strip(text);
  const out = [];
  for (const m of src.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm))
    for (const part of m[1].split(","))
      out.push({ dots: 0, mod: part.trim().split(/\s+as\s+/)[0].trim(), names: [] });
  for (const m of src.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]+)/gm)) {
    const names = m[3].replace(/[()\\]/g, " ").split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim());
    out.push({ dots: m[1].length, mod: m[2], names: names.filter((n) => n && n !== "*") });
  }
  return out;
}

export default {
  id: "python",
  ext: /\.pyi?$/i,
  edges(sources) {
    // "a/b" -> files for module a.b, keyed by path tail so any source root matches. A root is a
    // directory that is not itself a package: `import logging` must not find app/logging.py.
    const packages = new Set([...sources.keys()].filter((p) => /(^|\/)__init__\.pyi?$/i.test(p)).map(dirOf));
    const byTail = new Map();
    const exact = new Map();
    for (const p of sources.keys()) {
      const mod = p.replace(/\.pyi?$/i, "").replace(/(^|\/)__init__$/, "");
      exact.set(mod, exact.get(mod) ?? p);
      const parts = mod.split("/");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0 && packages.has(parts.slice(0, i).join("/"))) continue;
        const tail = parts.slice(i).join("/");
        if (!byTail.has(tail)) byTail.set(tail, []);
        byTail.get(tail).push(p);
      }
    }
    const closest = (hits, from) =>
      hits.length <= 1 ? hits[0] : hits.reduce((a, b) => (common(b, from) > common(a, from) ? b : a));
    const common = (a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i;
    };

    const out = [];
    for (const [p, text] of sources) {
      const pkgDir = dirOf(p);
      for (const { dots, mod, names } of pyImports(text)) {
        const segs = mod ? mod.split(".") : [];
        let find;
        if (dots) {
          let base = pkgDir;
          for (let i = 1; i < dots && base != null; i++) base = base ? dirOf(base) : null;
          if (base == null) continue;
          find = (s) => exact.get(joinRepo(base, s.join("/")) ?? "");
        } else find = (s) => (s.length ? closest(byTail.get(s.join("/")) ?? [], p) : undefined);
        // `from a import b`: b may be a module of its own; otherwise it is a name in a.
        let hit = false;
        for (const n of names) {
          const sub = find([...segs, n]);
          if (sub) out.push([p, sub]), (hit = true);
        }
        if (hit) continue;
        // `import a.b.c`: the longest prefix that is a repo module (for `from . import x`, the
        // package itself).
        for (let k = segs.length; k >= (dots ? 0 : 1); k--) {
          const m = find(segs.slice(0, k));
          if (m) {
            out.push([p, m]);
            break;
          }
        }
      }
    }
    return out;
  },
};
