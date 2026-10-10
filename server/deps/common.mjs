// Helpers the language modules share. A language module exports
//   { id, ext: RegExp for its sources, reads?: RegExp for config files it needs (go.mod, Cargo.toml),
//     edges(sources: Map<path, text>, ctx) -> iterable of [from, to] }
// where ctx = { files: Set of every repo path, read(path) -> text | null }. buildDeps (../deps.mjs)
// reads each source once, hands every module its own files, and drops duplicates and self-edges.

export const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);

/** Join and normalize "a/b" + "../c" -> "a/c"; null when it climbs out of the repo. */
export function joinRepo(dir, rel) {
  const out = dir ? dir.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** Comments and string/char literals out of C-like code, so names inside them do not count. */
export const stripCLike = (text) =>
  text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, " ");

const sharedPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/**
 * Finds repo files by a path tail ("net/http.h" -> "src/lib/net/http.h"), for includes and
 * imports whose search roots are not known. Among several hits, the one closest to `from` wins.
 */
export function tailIndex(paths) {
  const byBase = new Map();
  for (const p of paths) {
    const b = baseOf(p);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p);
  }
  return (tail, from) => {
    const hits = (byBase.get(baseOf(tail)) ?? []).filter((p) => p === tail || p.endsWith("/" + tail));
    if (hits.length <= 1) return hits[0] ?? null;
    return hits.reduce((best, p) => (sharedPrefix(p, from) > sharedPrefix(best, from) ? p : best));
  };
}

/**
 * Edges for languages where a file uses a type by naming it, and namespaces decide which
 * declarations it can see (C#, Java/Kotlin/Scala, PHP, Swift, Ruby). Each parsed file is
 *   { ns, types: [names it declares], idents: Set of names it uses,
 *     opens?: [namespaces it imports whole], globals?: [namespaces opened for every file],
 *     singles?: Map local name -> [ns, name] (one imported type, possibly renamed),
 *     forced?: [[ns, name]] (a type it depends on whatever it names, e.g. a static import) }
 * `parents`: whether a file also sees its namespace's parents (C# does, Java does not). The
 * global namespace "" is always visible.
 */
export function namespaceEdges(parsed, { parents = false } = {}) {
  const byNs = new Map(); // ns -> name -> [files declaring it]
  const globals = new Set();
  for (const [p, f] of parsed) {
    for (const g of f.globals ?? []) globals.add(g);
    let names = byNs.get(f.ns);
    if (!names) byNs.set(f.ns, (names = new Map()));
    for (const t of f.types) {
      if (!names.has(t)) names.set(t, []);
      names.get(t).push(p);
    }
  }
  const lookup = (ns, name) => byNs.get(ns)?.get(name) ?? [];
  const out = [];
  for (const [p, f] of parsed) {
    const visible = new Set([...(f.opens ?? []), ...globals, f.ns, ""]);
    if (parents) for (let n = f.ns; n.includes("."); ) visible.add((n = n.slice(0, n.lastIndexOf("."))));
    const spaces = [...visible].map((n) => byNs.get(n)).filter(Boolean);
    for (const name of f.idents) {
      const single = f.singles?.get(name);
      if (single) {
        for (const d of lookup(...single)) out.push([p, d]);
        continue;
      }
      for (const names of spaces) for (const d of names.get(name) ?? []) out.push([p, d]);
    }
    for (const [ns, name] of f.forced ?? []) for (const d of lookup(ns, name)) out.push([p, d]);
  }
  return out;
}
