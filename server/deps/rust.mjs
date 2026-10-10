// Rust: `mod x;` leads to x.rs or x/mod.rs next to the module, and paths that start at
// `crate::`, `self::`, `super::` or another crate of the workspace (by its Cargo.toml name) lead
// to the deepest module file they name: `use crate::net::http::Client` -> src/net/http.rs.

import { baseOf, dirOf, joinRepo } from "./common.mjs";

// Comments and strings out. Char literals are matched one character long so a lifetime ('a)
// does not open a "string".
const strip = (text) =>
  text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|r(#*)"[\s\S]*?"\1|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\\n])'/g, " ");

const PATH = /\b(crate|self|super|[a-z_][a-z0-9_]*)((?:\s*::\s*[A-Za-z_]\w*)*)(?:\s*::\s*\{([^{}]*)\})?/g;

export default {
  id: "rust",
  ext: /\.rs$/i,
  reads: /(^|\/)Cargo\.toml$/,
  edges(sources, { files, read }) {
    // Crates: Cargo.toml directory -> its src/, and package name -> that src/.
    const crates = [];
    const byName = new Map();
    for (const p of files) {
      if (!/(^|\/)Cargo\.toml$/.test(p)) continue;
      const src = joinRepo(dirOf(p), "src");
      crates.push(src);
      const name = read(p)?.match(/^\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      if (name) byName.set(name.replace(/-/g, "_"), src);
    }
    const crateOf = (p) => crates.filter((c) => p.startsWith(c + "/")).sort((a, b) => b.length - a.length)[0] ?? null;
    // The directory a file's child modules live in.
    const modDir = (p) => (/^(mod|lib|main)\.rs$/.test(baseOf(p)) ? dirOf(p) : p.slice(0, -3));
    const moduleFile = (dir) => [`${dir}.rs`, `${dir}/mod.rs`].find((f) => files.has(f)) ?? null;
    // Deepest module file along base/segs[0]/segs[1]/...
    const deepest = (base, segs) => {
      for (let k = segs.length; k > 0; k--) {
        const f = moduleFile(joinRepo(base, segs.slice(0, k).join("/")) ?? "");
        if (f) return f;
      }
      return null;
    };

    const out = [];
    for (const [p, text] of sources) {
      const src = strip(text);
      for (const m of src.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
        const f = moduleFile(`${modDir(p)}/${m[1]}`.replace(/^\//, ""));
        if (f) out.push([p, f]);
      }
      for (const [, head, rest, group] of src.matchAll(PATH)) {
        if (!rest && !group) continue;
        let base;
        let segs = rest.split("::").map((s) => s.trim()).filter(Boolean);
        if (head === "crate") base = crateOf(p);
        else if (head === "self") base = modDir(p);
        else if (head === "super") {
          base = dirOf(modDir(p));
          while (segs[0] === "super") (base = dirOf(base)), segs.shift();
        } else base = byName.get(head);
        if (base == null) continue;
        const tails = group ? group.split(",").map((g) => g.trim().split(/\s*::\s*|\s+as\s+/)[0]) : [null];
        for (const t of tails) {
          const f = deepest(base, t && t !== "self" && t !== "*" ? [...segs, t] : segs);
          if (f) out.push([p, f]);
        }
      }
    }
    return out;
  },
};
