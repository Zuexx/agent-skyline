// Find repo files named in a shell command, so reads done through Bash (`sed -n 1,40p x.cs`,
// `cat a/b.ts`, `grep -n foo api/x.cs`) can light up the city too. Only paths that exist as
// buildings are returned, so a stray word never invents a file.

/** Index of known building paths for fast lookups. */
export function pathIndex(paths) {
  const exact = new Set(paths);
  const byBase = new Map();
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(p);
  }
  return { exact, byBase, all: paths };
}

const SPLIT = /[\s'"`;|&()<>=,]+/;

/**
 * Repo-relative paths of known files mentioned in `command`.
 * - exact repo-relative path → match;
 * - a relative path from a subfolder (`cd api && cat ForgeKit.Api/Program.cs`) → match when exactly
 *   one known path ends with "/<token>";
 * - a bare file name → match only when exactly one file has that name.
 */
export function pathsInCommand(command, index) {
  if (!command || !index) return [];
  const found = new Set();
  for (let raw of String(command).split(SPLIT)) {
    let t = raw.replace(/^\.\//, "").replace(/\\/g, "/").replace(/[.:]+$/, "");
    if (!t || (!t.includes(".") && !t.includes("/"))) continue;
    if (t.startsWith("/d/") || /^[a-z]:\//i.test(t)) continue; // absolute: cannot be matched reliably
    if (index.exact.has(t)) {
      found.add(t);
      continue;
    }
    if (t.includes("/")) {
      const hits = index.all.filter((p) => p.endsWith("/" + t));
      if (hits.length === 1) found.add(hits[0]);
      continue;
    }
    const byName = index.byBase.get(t);
    if (byName?.length === 1) found.add(byName[0]);
  }
  return [...found];
}
