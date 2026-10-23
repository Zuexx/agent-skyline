// Walking routes through the painted town (specs/09 §3.2): characters keep to the streets and go
// around houses instead of through them. Works in layout metres (x east, z south, the plaza at 0,0),
// on a 1 m grid. Pure, no three.js.

const CELL = 1; // metres
const ROAD_HALF = 1.8; // the main streets run along x = 0 and z = 0
const GRASS_COST = 2.5; // grass is walkable, streets are preferred

/**
 * A walking grid for the town. `houses`: [[x, z]] front-bottom points of the buildings; a house
 * fills about 7 m across and 6 m behind (north of) that point.
 */
export function makeGrid(houses, { minX = -62, maxX = 62, minZ = -62, maxZ = 32 } = {}) {
  const w = Math.round((maxX - minX) / CELL) + 1;
  const h = Math.round((maxZ - minZ) / CELL) + 1;
  const cost = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = minX + i * CELL;
      const z = minZ + j * CELL;
      cost[j * w + i] = Math.abs(x) <= ROAD_HALF || Math.abs(z) <= ROAD_HALF ? 1 : GRASS_COST;
    }
  }
  for (const [hx, hz] of houses) {
    for (let j = 0; j < h; j++) {
      const z = minZ + j * CELL;
      if (z < hz - 6.5 || z > hz - 0.3) continue;
      for (let i = 0; i < w; i++) {
        const x = minX + i * CELL;
        if (Math.abs(x - hx) <= 3.5) cost[j * w + i] = Infinity;
      }
    }
  }
  return { w, h, minX, minZ, cost };
}

const cellOf = (g, [x, z]) => [
  Math.min(g.w - 1, Math.max(0, Math.round((x - g.minX) / CELL))),
  Math.min(g.h - 1, Math.max(0, Math.round((z - g.minZ) / CELL))),
];
const pointOf = (g, i, j) => [g.minX + i * CELL, g.minZ + j * CELL];

// The nearest walkable cell to (i, j) (a door spot can sit right against its house).
function nearestOpen(g, i, j) {
  if (g.cost[j * g.w + i] < Infinity) return [i, j];
  for (let r = 1; r < 12; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < g.w && b < g.h && g.cost[b * g.w + a] < Infinity) return [a, b];
      }
    }
  }
  return [i, j];
}

/**
 * The route from `from` to `to` ([x, z] layout metres): [[x, z], ...] starting at `from` and ending
 * at `to`, keeping to streets where it can and never crossing a house; smoothed so turns are round.
 */
export function findPath(g, from, to) {
  const [si, sj] = nearestOpen(g, ...cellOf(g, from));
  const [ti, tj] = nearestOpen(g, ...cellOf(g, to));
  const start = sj * g.w + si;
  const goal = tj * g.w + ti;
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const closed = new Uint8Array(g.w * g.h);
  const heap = new MinHeap();
  const hEst = (k) => Math.hypot((k % g.w) - ti, Math.floor(k / g.w) - tj);
  dist[start] = 0;
  heap.push(start, hEst(start));
  while (heap.size) {
    const k = heap.pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % g.w;
    const j = Math.floor(k / g.w);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
        const n = b * g.w + a;
        const c = g.cost[n];
        if (c === Infinity || closed[n]) continue;
        // no cutting a house's corner diagonally
        if (di && dj && (g.cost[j * g.w + a] === Infinity || g.cost[b * g.w + i] === Infinity)) continue;
        const nd = dist[k] + c * (di && dj ? Math.SQRT2 : 1);
        if (nd < dist[n]) {
          dist[n] = nd;
          prev[n] = k;
          heap.push(n, nd + hEst(n));
        }
      }
    }
  }
  if (prev[goal] < 0 && goal !== start) return [from, to]; // walled in: go straight
  const cells = [];
  for (let k = goal; k >= 0; k = prev[k]) cells.push(pointOf(g, k % g.w, Math.floor(k / g.w)));
  cells.reverse();
  return smooth([from, ...simplify(cells.slice(1, -1)), to]);
}

// Drop the points in the middle of straight runs.
function simplify(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (a && c && Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-9) continue;
    out.push(b);
  }
  return out;
}

// Chaikin corner cutting, twice: round turns, same start and end.
function smooth(pts) {
  let p = pts;
  for (let n = 0; n < 2 && p.length > 2; n++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]];
      if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < p.length - 2) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Length of a route in metres. */
export const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const { k, v } = this;
    const top = k[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The inverse of a 3x3 matrix (rows), for painting pixels -> layout metres. */
export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
