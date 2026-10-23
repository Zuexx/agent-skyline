// Which folders are buildings, and where a folder the painting does not have yet goes (specs/09
// §2.1, §11; specs/10 "When to repaint"). Pure, no React, no three.js.
//
// One folder = one building. A top-level folder with many files is split into its subfolders (and
// once more a level down); a subfolder with only a few files stays in the folder above it.
// The painted buildings stay tied to their folders: a painted folder keeps its building even if the
// rule would now merge it, so the painting never loses a house it shows. A group the painting does
// not have becomes a construction site until the town is repainted.

export const SPLIT_OVER = 30; // a folder with more files than this is split into its subfolders
export const MERGE_UNDER = 5; // a subfolder with fewer files than this stays in its parent's building
export const ROOT = "(root)";

const parentOf = (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : ROOT);

/** Building id for each path, by the split/merge rule: Map(id -> [paths]). */
export function groupFiles(paths) {
  const under = new Map(); // folder -> number of files below it
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      under.set(dir, (under.get(dir) ?? 0) + 1);
    }
  }
  const raw = (p) => {
    const parts = p.split("/");
    if (parts.length === 1) return ROOT;
    let id = parts[0];
    // Split while the folder is big and the file sits deeper (at most two levels, as the painting did).
    for (let depth = 2; depth <= 3 && parts.length > depth && under.get(id) > SPLIT_OVER; depth++) id = parts.slice(0, depth).join("/");
    return id;
  };
  const groups = new Map();
  for (const p of paths) {
    const id = raw(p);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  // Merge small subfolder groups into their parent, deepest first (a parent may then grow enough,
  // or be a new group that is itself small, hence the repeat).
  for (let merged = true; merged; ) {
    merged = false;
    for (const id of [...groups.keys()].sort((a, b) => b.split("/").length - a.split("/").length)) {
      if (!id.includes("/") || groups.get(id).length >= MERGE_UNDER) continue;
      const parent = parentOf(id);
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(...groups.get(id));
      groups.delete(id);
      merged = true;
    }
  }
  return groups;
}

/** What a folder's files mostly are (same rules as the painting's layout script). */
export function roleOf(path) {
  const p = path.toLowerCase();
  if (/(^|\/)(tests?|__tests__)\/|\.test\.|\.spec\.|_test\./.test(p)) return "test";
  if (/\.(md|txt)$/.test(p) || p.startsWith("docs/") || p.startsWith("specs/")) return "docs";
  if (/\.(json|ya?ml|toml|ini)$/.test(p) || p.startsWith(".github/") || p.startsWith("install/") || p.includes("/.") || p.startsWith(".")) return "config";
  if (/\.(png|jpe?g|mp4|svg|ico|webp)$/.test(p)) return "asset";
  return "code";
}

function mainRole(paths) {
  const n = new Map();
  for (const p of paths) n.set(roleOf(p), (n.get(roleOf(p)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

// Streets out of the plaza, in layout metres (x east, z south): 0 west, 1 north, 2 east, 3 south.
const ARMS = [
  [-1, 0],
  [0, -1],
  [1, 0],
  [0, 1],
];
const STREET = { test: 1, docs: 1, config: 3, asset: 3 };
const START = 16;
const STEP = 12;
const OFF = 7.5;

const top = (id) => id.split("/")[0];

/**
 * The town: [{ id, files, role, painted, lot? }]. `painted` is the pack's buildings
 * ([{ id, layout: [x, z] }]) and `lots` the open ground the painting has room on ([[x, z]], layout
 * metres). A building the painting lacks is a construction site: it takes the free lot nearest to
 * where its street would continue (`lot`), or none when the lots run out (the town needs a repaint).
 */
export function townBuildings(paths, painted, lots = []) {
  const groups = groupFiles(paths);
  const paintedIds = new Set(painted.map((b) => b.id));
  // Painted folders keep their building while they still hold files.
  const ids = new Set(groups.keys());
  for (const id of paintedIds) if (id === ROOT || paths.some((p) => p.startsWith(id + "/"))) ids.add(id);
  const files = new Map([...ids].map((id) => [id, []]));
  for (const p of paths) files.get(buildingOf(p, ids)).push(p);

  const out = [...files]
    .filter(([id, fs]) => fs.length || paintedIds.has(id))
    .map(([id, fs]) => ({ id, files: fs.length, role: id === ROOT ? "config" : fs.length ? mainRole(fs) : "code", painted: paintedIds.has(id) }));

  // The main block (most code files) keeps its own street, as in the painting; parts of one
  // top-level folder stay neighbours, on the street of their biggest part.
  const codeByTop = new Map();
  for (const b of out) if (b.id !== ROOT && b.role === "code") codeByTop.set(top(b.id), (codeByTop.get(top(b.id)) ?? 0) + b.files);
  const mainBlock = [...codeByTop].sort((a, b) => b[1] - a[1])[0]?.[0];
  const armByTop = new Map();
  for (const b of [...out].sort((a, b) => b.files - a.files)) {
    if (!armByTop.has(top(b.id))) armByTop.set(top(b.id), top(b.id) === mainBlock ? 0 : b.role === "code" ? 2 : STREET[b.role]);
  }

  // Where each new building would go if its street went on: one more slot past the painted houses.
  const used = [0, 0, 0, 0];
  for (const b of painted) if (b.id !== ROOT && b.layout) used[nearestArm(b.layout)]++;
  const free = lots.map((l) => [...l]);
  for (const b of out.filter((b) => !b.painted).sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : 1))) {
    const arm = armByTop.get(top(b.id)) ?? 2;
    const k = used[arm]++;
    const along = START + Math.floor(k / 2) * STEP + (arm === 1 ? 6 : 0);
    const side = k % 2 === 0 ? 1 : -1;
    const [dx, dz] = ARMS[arm];
    const ideal = [dx * along - dz * OFF * side, dz * along + dx * OFF * side];
    let best = -1;
    free.forEach((l, i) => {
      if (best < 0 || Math.hypot(l[0] - ideal[0], l[1] - ideal[1]) < Math.hypot(free[best][0] - ideal[0], free[best][1] - ideal[1])) best = i;
    });
    b.lot = best < 0 ? null : free.splice(best, 1)[0];
  }
  return out;
}

// The street a layout spot is on: the arm whose direction it lies furthest along.
function nearestArm([x, z]) {
  let best = 0;
  ARMS.forEach(([dx, dz], i) => {
    if (dx * x + dz * z > ARMS[best][0] * x + ARMS[best][1] * z) best = i;
  });
  return best;
}

/** The building that holds `path`: the longest id that is its folder or one above; else the root. */
export function buildingOf(path, ids) {
  let best = null;
  for (const id of ids) if (id !== ROOT && path.startsWith(id + "/") && (!best || id.length > best.length)) best = id;
  return best ?? ROOT;
}

/** A layout point through the pack's layout -> painting homography (3x3, rows). */
export function layoutToPixel(h, [x, z]) {
  const w = h[2][0] * x + h[2][1] * z + h[2][2];
  return [(h[0][0] * x + h[0][1] * z + h[0][2]) / w, (h[1][0] * x + h[1][1] * z + h[1][2]) / w];
}
