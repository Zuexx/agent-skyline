// Which repo files use which: the roads of the city. Cheap, explainable heuristics per language,
// no parser and no toolchain, so they work the same on a git ref (branch comparison) as on disk:
//
// - JS/TS (this file): relative imports ("./x", "../y") and tsconfig `paths` aliases ("@/lib/x"),
//   resolved against the repo's own file list (extensions and index files tried in the usual
//   order). Package imports ("react") are not repo files and are ignored.
// - Every other language is a module in deps/ (deps/common.mjs describes its shape): C#, Go,
//   Python, Java/Kotlin/Scala, C/C++/Objective-C, Rust, PHP, Ruby, Swift. Supporting another
//   language is writing one more module and listing it in LANGUAGES below.
//
// JS/TS imports whose names the file never uses are kept, marked "unused": a leftover import is
// still loaded at run time, and is worth a look in review. The other languages get no such mark.
//
// Returns { edges: [[from, to] or [from, to, "unused"], ...], truncated } with repo paths,
// deduplicated, no self-edges.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { dirOf, joinRepo } from "./deps/common.mjs";
import cfamily from "./deps/cfamily.mjs";
import csharp from "./deps/csharp.mjs";
import go from "./deps/go.mjs";
import jvm from "./deps/jvm.mjs";
import php from "./deps/php.mjs";
import python from "./deps/python.mjs";
import ruby from "./deps/ruby.mjs";
import rust from "./deps/rust.mjs";
import swift from "./deps/swift.mjs";

export { joinRepo };
const LANGUAGES = [csharp, go, python, jvm, cfamily, rust, php, ruby, swift];

const MAX_FILE_BYTES = 512 * 1024;
// Parsing is about 0.12 ms per file (VS Code: 8,000 files in 0.9 s), so even a large repo stays a
// few seconds, once, on the first /api/deps. A cap at 8,000 cut VS Code (14,848 sources) halfway
// through the alphabet, leaving most of src/vs without roads.
const MAX_PARSED_FILES = 40000;

const JS_EXT = /\.(m|c)?(j|t)sx?$/i;
const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/i;
const languageOf = (p) => LANGUAGES.find((l) => l.ext.test(p));

/**
 * Files buildDeps reads: sources, tsconfigs and what the languages need besides (go.mod,
 * Cargo.toml). Lets a git-ref reader load only these.
 */
export const readsFile = (p) => JS_EXT.test(p) || TSCONFIG.test(p) || LANGUAGES.some((l) => l.ext.test(p) || l.reads?.test(p));
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/** Reads repo files from the working tree; buildDeps takes another reader for a git ref. */
export const diskReader = (root) => (p) => {
  const abs = path.join(root, ...p.split("/"));
  try {
    if (statSync(abs).size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

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
function loadAliases(read, paths) {
  const out = [];
  for (const p of paths) {
    if (!TSCONFIG.test(p)) continue;
    const text = read(p);
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
// `import <clause> from "x"`: the clause names what the file gets (default, { named }, * as ns).
const CLAUSE_RE = /\bimport\s+(?:type\s+)?([\w$*{},\s]+?)\s*from\s*["']([^"'\n]+)["']/g;
// Forms that are a dependency whatever names are used: re-exports, side-effect imports, require()
// and dynamic import().
const ALWAYS_RE = [
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s*from\s*["']([^"'\n]+)["']/g,
  /\b(?:import|require)\s*\(\s*["']([^"'\n]+)["']/g,
  /^\s*import\s*["']([^"'\n]+)["']/gm,
];
const STATEMENT_RE = /\b(?:import|export)\s+[^;'"]*?from\s*["'][^"'\n]+["'];?|^\s*import\s*["'][^"'\n]+["'];?/gm;

/** Local names an import clause binds: "React, { useState as useS, type FC }" -> React, useS, FC. */
export function clauseNames(clause) {
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  for (const part of (braces ? braces[1] : "").split(",")) {
    const local = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
    if (local) names.push(local);
  }
  const outside = clause.replace(/\{[^}]*\}/, "");
  const ns = outside.match(/\*\s*as\s+([\w$]+)/);
  if (ns) names.push(ns[1]);
  const def = outside.replace(/\*\s*as\s+[\w$]+/, "").replace(/,/g, " ").trim();
  if (def) names.push(...def.split(/\s+/).filter(Boolean));
  return names;
}

// Comments out, so a name mentioned only in a comment does not count as used. "//" right after
// ":" or a quote is left alone (URLs in strings).
const stripJsComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

/**
 * Repo files a JS/TS file imports: Map target -> true when something it imports from there is
 * used, false when it imports names from it and uses none of them (a leftover import).
 */
function jsEdges(p, source, files, aliases) {
  // A commented-out import (`// import { X } from "./x"`) is no dependency at all.
  const text = stripJsComments(source);
  const resolve = (spec) => {
    const candidates = spec.startsWith(".") ? [joinRepo(dirOf(p), spec)] : aliasTargets(spec, p, aliases);
    for (const c of candidates) {
      const hit = resolveFile(c, files);
      if (hit && hit !== p) return hit;
    }
    return null;
  };
  const always = new Set();
  for (const re of ALWAYS_RE) for (const m of text.matchAll(re)) always.add(m[1]);
  const named = new Map(); // spec -> names it binds
  for (const m of text.matchAll(CLAUSE_RE)) named.set(m[2], [...(named.get(m[2]) ?? []), ...clauseNames(m[1])]);
  const body = text.replace(STATEMENT_RE, " ");
  const isUsed = (name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(body);

  const out = new Map();
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    const hit = resolve(spec);
    if (!hit) continue;
    const names = named.get(spec);
    const used = always.has(spec) || !names || names.length === 0 || names.some(isUsed);
    out.set(hit, (out.get(hit) ?? false) || used);
  }
  return out;
}

/**
 * Wire form of buildDeps' result: { paths, edges: [from0, to0, from1, to1, ...] as indexes into
 * paths, unused: [edge numbers marked unused], truncated }. Repeating both full paths per edge made VS Code's 139k edges 17 MB of JSON;
 * this is 2.4 MB. The UI unpacks it (web/src/lib/deps.js).
 */
export function packDeps({ edges, truncated }) {
  const index = new Map();
  const paths = [];
  const id = (p) => {
    let i = index.get(p);
    if (i === undefined) index.set(p, (i = paths.push(p) - 1));
    return i;
  };
  const flat = new Array(edges.length * 2);
  const unused = [];
  edges.forEach(([from, to, flag], k) => {
    flat[2 * k] = id(from);
    flat[2 * k + 1] = id(to);
    if (flag === "unused") unused.push(k);
  });
  return { paths, edges: flat, unused, truncated };
}

/**
 * Dependency edges among `paths` (repo-relative, "/"-separated). `read(path)` returns a file's
 * text or null; by default the working tree of the repo at `root`.
 */
export function buildDeps(root, paths, read = diskReader(root)) {
  const files = new Set(paths);
  const sources = paths.filter((p) => JS_EXT.test(p) || languageOf(p));
  const truncated = sources.length > MAX_PARSED_FILES;
  const aliases = loadAliases(read, paths);
  const edges = [];
  const byLanguage = new Map(LANGUAGES.map((l) => [l, new Map()]));
  for (const p of sources.slice(0, MAX_PARSED_FILES)) {
    const text = read(p);
    if (text == null) continue;
    const lang = JS_EXT.test(p) ? null : languageOf(p);
    if (lang) byLanguage.get(lang).set(p, text);
    else for (const [to, used] of jsEdges(p, text, files, aliases)) edges.push(used ? [p, to] : [p, to, "unused"]);
  }
  const seen = new Set();
  for (const [lang, texts] of byLanguage) {
    if (!texts.size) continue;
    for (const [from, to] of lang.edges(texts, { files, read })) {
      const key = `${from}\n${to}`;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      edges.push([from, to]);
    }
  }
  return { edges, truncated };
}
