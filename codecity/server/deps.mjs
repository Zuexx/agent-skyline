// Which repo files use which: the roads of the city. Two cheap, explainable heuristics, no parser:
//
// - JS/TS: relative imports ("./x", "../y") and tsconfig `paths` aliases ("@/lib/x"), resolved
//   against the repo's own file list (extensions and index files tried in the usual order).
//   Package imports ("react") are not repo files and are ignored.
// - C#: a file uses a type when it names it and the type's namespace is visible to it (its own
//   namespace and parents, its `using` lines, and any `global using`). Types are found from
//   `class/record/interface/enum/struct` declarations. Good enough to say "who uses this", not a
//   compiler: a type name that happens to appear in a comment can add an edge.
//
// Returns { edges: [[from, to], ...], truncated } with repo paths, deduplicated, no self-edges.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PARSED_FILES = 8000; // beyond this the city is too dense for roads to be readable anyway

const JS_EXT = /\.(m|c)?(j|t)sx?$/i;
const CS_EXT = /\.cs$/i;
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

const readText = (root, p) => {
  const abs = path.join(root, ...p.split("/"));
  try {
    if (statSync(abs).size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

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

/** First existing repo file for an import target without (or with) an extension. */
function resolveFile(target, files) {
  if (target == null) return null;
  if (files.has(target) && JS_EXT.test(target)) return target;
  // ESM TypeScript writes "./x.js" for x.ts.
  const stripped = target.replace(/\.(m|c)?js$/i, "");
  for (const base of stripped === target ? [target] : [stripped, target]) {
    for (const ext of RESOLVE_EXT) if (files.has(base + ext)) return base + ext;
    for (const ext of RESOLVE_EXT) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  return files.has(target) ? target : null;
}

/** Lenient JSON for tsconfig: comments and trailing commas allowed. */
function parseJsonc(text) {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
  return JSON.parse(noComments.replace(/,\s*([}\]])/g, "$1"));
}

/** tsconfig `paths` per directory: [{ dir, rules: [{ prefix, suffix, targets }] }], deepest first. */
function loadAliases(root, paths) {
  const out = [];
  for (const p of paths) {
    if (!/(^|\/)tsconfig[^/]*\.json$/i.test(p)) continue;
    const text = readText(root, p);
    if (!text) continue;
    let opts;
    try {
      opts = parseJsonc(text).compilerOptions ?? {};
    } catch {
      continue;
    }
    if (!opts.paths) continue;
    const dir = dirOf(p);
    const baseDir = joinRepo(dir, opts.baseUrl ?? ".") ?? dir;
    const rules = Object.entries(opts.paths).map(([pattern, targets]) => {
      const star = pattern.indexOf("*");
      return {
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? null : pattern.slice(star + 1),
        targets: (Array.isArray(targets) ? targets : []).map((t) => ({ t, baseDir })),
      };
    });
    out.push({ dir, rules });
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

function aliasTargets(spec, fromPath, aliases) {
  const cfg = aliases.find((a) => a.dir === "" || fromPath === a.dir || fromPath.startsWith(a.dir + "/"));
  if (!cfg) return [];
  const found = [];
  for (const r of cfg.rules) {
    if (r.suffix == null) {
      if (spec === r.prefix) found.push(...r.targets.map(({ t, baseDir }) => joinRepo(baseDir, t)));
    } else if (spec.startsWith(r.prefix) && spec.endsWith(r.suffix) && spec.length >= r.prefix.length + r.suffix.length) {
      const mid = spec.slice(r.prefix.length, spec.length - r.suffix.length);
      found.push(...r.targets.map(({ t, baseDir }) => joinRepo(baseDir, t.replace("*", mid))));
    }
  }
  return found.filter(Boolean);
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'\n]+)["']/gm;

function jsEdges(p, text, files, aliases) {
  const out = new Set();
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    const candidates = spec.startsWith(".") ? [joinRepo(dirOf(p), spec)] : aliasTargets(spec, p, aliases);
    for (const c of candidates) {
      const hit = resolveFile(c, files);
      if (hit && hit !== p) {
        out.add(hit);
        break;
      }
    }
  }
  return out;
}

// C#: strip comments and string literals before looking at identifiers.
const stripCs = (text) => text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|@"(?:""|[^"])*"|"(?:\\.|[^"\\\n])*"/g, " ");

function parseCs(text) {
  const src = stripCs(text);
  const ns = src.match(/\bnamespace\s+([\w.]+)/)?.[1] ?? "";
  const usings = [];
  const globals = [];
  for (const m of src.matchAll(/^\s*(global\s+)?using\s+(?!static\b)([\w.]+)\s*;/gm)) (m[1] ? globals : usings).push(m[2]);
  const types = [...src.matchAll(/\b(?:class|record|interface|enum|struct)\s+([A-Z]\w*)/g)].map((m) => m[1]);
  const idents = new Set(src.match(/\b[A-Z]\w*\b/g) ?? []);
  return { ns, usings, globals, types, idents };
}

function csEdges(parsed) {
  // namespace -> type name -> files declaring it
  const byNs = new Map();
  const globals = new Set();
  for (const [p, f] of parsed) {
    f.globals.forEach((g) => globals.add(g));
    let names = byNs.get(f.ns);
    if (!names) byNs.set(f.ns, (names = new Map()));
    for (const t of f.types) {
      if (!names.has(t)) names.set(t, []);
      names.get(t).push(p);
    }
  }
  const edges = new Map();
  for (const [p, f] of parsed) {
    const visible = new Set([...f.usings, ...globals]);
    for (let n = f.ns; n; n = n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : "") visible.add(n);
    visible.add("");
    const out = new Set();
    for (const n of visible) {
      const names = byNs.get(n);
      if (!names) continue;
      for (const [t, decl] of names) if (f.idents.has(t)) for (const d of decl) if (d !== p) out.add(d);
    }
    edges.set(p, out);
  }
  return edges;
}

/** Dependency edges among `paths` (repo-relative, "/"-separated) of the repo at `root`. */
export function buildDeps(root, paths) {
  const files = new Set(paths);
  const sources = paths.filter((p) => JS_EXT.test(p) || CS_EXT.test(p));
  const truncated = sources.length > MAX_PARSED_FILES;
  const aliases = loadAliases(root, paths);
  const edges = [];
  const cs = new Map();
  for (const p of sources.slice(0, MAX_PARSED_FILES)) {
    const text = readText(root, p);
    if (text == null) continue;
    if (CS_EXT.test(p)) cs.set(p, parseCs(text));
    else for (const to of jsEdges(p, text, files, aliases)) edges.push([p, to]);
  }
  for (const [from, tos] of csEdges(cs)) for (const to of tos) edges.push([from, to]);
  return { edges, truncated };
}
