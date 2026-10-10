// Go: an import of a package inside the repo (its path starts with a go.mod `module`) leads to the
// files of that package that declare a name the file uses as `pkg.Name`. Files of one package need
// no import: a file uses another when it names one of that file's top-level declarations, which is
// also how an x_test.go finds the code it tests. Methods are not followed (`v.Method()` says
// nothing about which file declares it); the receiver's type usually is.

import { dirOf, joinRepo } from "./common.mjs";

// Comments out, strings kept (import paths are strings).
const stripComments = (text) =>
  text.replace(/("(?:\\.|[^"\\\n])*"|`[^`]*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? " ");
// Strings and runes out too, for looking at identifiers.
const stripStrings = (text) => text.replace(/"(?:\\.|[^"\\\n])*"|`[^`]*`|'(?:\\.|[^'\\\n])*'/g, " ");

const NOT_A_DEPENDENCY = new Set(["_", "init", "main"]);

function parse(text) {
  const code = stripComments(text);
  const imports = []; // [alias or null, path]
  const spec = /^\s*([\w.]+\s+)?"([^"]+)"/gm;
  for (const block of code.matchAll(/^import\s*\(([\s\S]*?)\)/gm))
    for (const m of block[1].matchAll(spec)) imports.push([m[1]?.trim() ?? null, m[2]]);
  for (const m of code.matchAll(/^import\s+([\w.]+\s+)?"([^"]+)"/gm)) imports.push([m[1]?.trim() ?? null, m[2]]);

  const src = stripStrings(code);
  const declared = new Set();
  for (const m of src.matchAll(/^func\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
  for (const m of src.matchAll(/^(?:type|var|const)\s+([A-Za-z_]\w*)/gm)) declared.add(m[1]);
  // gofmt puts each entry of a `var (...)` / `const (...)` / `type (...)` block one tab in.
  for (const block of src.matchAll(/^(?:type|var|const)\s*\(([\s\S]*?)^\)/gm))
    for (const m of block[1].matchAll(/^\t([A-Za-z_]\w*)/gm)) declared.add(m[1]);
  for (const n of NOT_A_DEPENDENCY) declared.delete(n);

  return {
    pkg: src.match(/^package\s+(\w+)/m)?.[1] ?? "",
    imports,
    declared,
    idents: new Set(src.match(/\b[A-Za-z_]\w*\b/g) ?? []),
    selectors: new Set([...src.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*([A-Z]\w*)/g)].map((m) => `${m[1]}.${m[2]}`)),
  };
}

function modules(paths, read) {
  const mods = [];
  for (const p of paths) {
    if (!/(^|\/)go\.mod$/.test(p)) continue;
    const name = read(p)?.match(/^\s*module\s+"?([^\s"]+)"?/m)?.[1];
    if (name) mods.push({ dir: dirOf(p), name });
  }
  return mods.sort((a, b) => b.name.length - a.name.length);
}

export default {
  id: "go",
  ext: /\.go$/i,
  reads: /(^|\/)go\.mod$/,
  edges(sources, { files, read }) {
    const parsed = new Map([...sources].map(([p, t]) => [p, parse(t)]));
    const byDir = new Map();
    for (const p of parsed.keys()) {
      const d = dirOf(p);
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(p);
    }
    const mods = modules(files, read);
    const dirOfImport = (path) => {
      const m = mods.find((m) => path === m.name || path.startsWith(m.name + "/"));
      return m ? joinRepo(m.dir, path.slice(m.name.length + 1)) : null;
    };

    const out = [];
    for (const [p, f] of parsed) {
      // The same package: other files in the directory with the same package clause.
      for (const q of byDir.get(dirOf(p))) {
        if (q === p) continue;
        const g = parsed.get(q);
        if (g.pkg !== f.pkg) continue;
        for (const name of g.declared) if (!f.declared.has(name) && f.idents.has(name)) { out.push([p, q]); break; }
      }
      // Imported packages of this repo.
      for (const [alias, path] of f.imports) {
        const dir = dirOfImport(path);
        const targets = (dir != null && byDir.get(dir)?.filter((q) => !q.endsWith("_test.go"))) || [];
        if (!targets.length || alias === "_") continue;
        const name = alias ?? parsed.get(targets[0]).pkg;
        for (const q of targets) {
          const used = (n) => (alias === "." ? f.idents.has(n) : f.selectors.has(`${name}.${n}`));
          for (const n of parsed.get(q).declared) if (/^[A-Z]/.test(n) && used(n)) { out.push([p, q]); break; }
        }
      }
    }
    return out;
  },
};
