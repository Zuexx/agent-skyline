// Alternative ways to group the same files into districts. Each view lays the files out under a
// virtual path ("<group id>/<real path>"), so inside a group the folder structure is kept and every
// group gets its own labeled district. Group ids are language-neutral ("code", "test", ...); the
// labels come from i18n ("group.<id>"), so switching language never re-lays the city.
// Buildings keep their real path as identity, which is what lets the city animate between views.
import { layout } from "../../../server/layout.mjs";
import { parentDir } from "./parent.js";

/** Views in switcher order. `needsCompare`: only offered while a branch is being compared. */
export const VIEWS = [
  { id: "folder" },
  { id: "role" },
  { id: "touched" },
  { id: "diff", needsCompare: true },
];

const ASSET = /\.(png|jpe?g|gif|svg|ico|webp|mp4|webm|mp3|wav|woff2?|ttf|otf|eot|pdf)$/i;
const CONFIG =
  /(^|\/)\.[^/]+$|(^|\/)\.(github|claude|agents|config|githooks|template\.config)\/|\.(json|ya?ml|toml|ini|lock|csproj|sln|props|targets|editorconfig|env|example)$|(^|\/)(Dockerfile|compose\.ya?ml|LICENSE)$/i;
// Test folders, x.test.ts / x.spec.ts, Go and Python x_test.go / x_test.py / test_x.py, Ruby
// x_spec.rb, and JVM/.NET/PHP/Swift FooTest(s).java style names (case-sensitive: not "Contest").
const TEST = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[^./]+$|\.Tests\/|_(test|spec)\.[^./]+$|(^|\/)test_[^/]+\.py$/i;
const TEST_CLASS = /[a-z0-9]Tests?\.(java|kt|kts|scala|cs|php|swift)$/;
const DOC = /\.(md|mdx|txt|rst)$/i;

/** Role group id of a repo path. Order of checks matters: a test .json is a test, not config. */
export function roleOf(path) {
  if (TEST.test(path) || TEST_CLASS.test(path)) return "test";
  if (/^openspec\//.test(path)) return "spec";
  if (ASSET.test(path)) return "asset";
  if (DOC.test(path)) return "doc";
  if (CONFIG.test(path)) return "config";
  return "code";
}

/** Touched group id of a repo path from the activity state. */
export function touchedOf(path, files) {
  const f = files?.[path];
  if (f?.writes > 0 || f?.blocked > 0) return "written";
  if (f?.reads > 0) return "read";
  return "untouched";
}

const DIFF_GROUP = { A: "added", M: "modified", R: "modified", D: "deleted" };

/** Diff group id of a repo path, given a Map path -> { status }. */
export function diffOf(path, diff) {
  return DIFF_GROUP[diff?.get(path)?.status] ?? "unchanged";
}

/**
 * The city as drawn for one view: buildings in the SAME order as `city.buildings` (so instance i
 * is always the same file), each with x/z/height plus `dir` (its district in this view), and the
 * view's districts. `ctx` = { files, diff }.
 */
export function buildView(city, viewId, ctx = {}) {
  if (viewId === "folder" || !city) {
    return {
      buildings: city.buildings.map((b) => ({ ...b, dir: parentDir(b.path) })),
      districts: city.districts,
      width: city.width,
      depth: city.depth,
      grouped: false,
    };
  }
  const group =
    viewId === "role"
      ? roleOf
      : viewId === "diff"
        ? (p) => diffOf(p, ctx.diff)
        : (p) => touchedOf(p, ctx.files);
  const laid = layout(city.buildings.map((b) => ({ path: `${group(b.path)}/${b.path}`, src: b.path, lines: b.lines })));
  const bySrc = new Map(laid.buildings.map((b) => [b.src, b]));
  return {
    buildings: city.buildings.map((b) => {
      const v = bySrc.get(b.path);
      return { ...b, x: v.x, z: v.z, dir: parentDir(v.path) };
    }),
    districts: laid.districts,
    width: laid.width,
    depth: laid.depth,
    grouped: true, // top-level districts are group ids, to be shown through i18n
  };
}
