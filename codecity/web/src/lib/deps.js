import { useEffect, useMemo, useState } from "react";
import { roleOf } from "./views.js";

const edgeKey = (from, to) => `${from}\0${to}`;

/**
 * Index edges [[from, to] or [from, to, "unused"]] both ways: uses (from -> its targets), usedBy
 * (to -> its users), and `unused`, the set of from->to imports whose names are never used.
 */
export function indexDeps(edges = []) {
  const uses = new Map();
  const usedBy = new Map();
  const unused = new Set();
  const add = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  for (const [from, to, flag] of edges) {
    add(uses, from, to);
    add(usedBy, to, from);
    if (flag === "unused") unused.add(edgeKey(from, to));
  }
  for (const m of [uses, usedBy]) for (const list of m.values()) list.sort();
  return { uses, usedBy, unused };
}

/** Edges from the server's packed form ({ paths, edges: flat index pairs, unused }, see deps.mjs). */
export function unpackDeps({ paths = [], edges = [], unused = [] }) {
  // An older server sends [[from, to], ...] directly; a page reloaded before the server restarts
  // must still work.
  if (Array.isArray(edges[0])) return edges;
  const out = new Array(Math.floor(edges.length / 2));
  for (let k = 0; k < out.length; k++) out[k] = [paths[edges[2 * k]], paths[edges[2 * k + 1]]];
  for (const k of unused) if (out[k]) out[k] = [...out[k], "unused"];
  return out;
}

/**
 * What one file uses, what uses it, and which of those users are tests. `unusedUses`: the files
 * it imports without using anything from them; `unusedBy`: the files that import it that way.
 */
export function depsOf(index, path) {
  const uses = index?.uses.get(path) ?? [];
  const usedBy = index?.usedBy.get(path) ?? [];
  const unused = index?.unused ?? new Set();
  return {
    uses,
    usedBy: usedBy.filter((p) => roleOf(p) !== "test"),
    testedBy: usedBy.filter((p) => roleOf(p) === "test"),
    unusedUses: new Set(uses.filter((to) => unused.has(edgeKey(path, to)))),
    unusedBy: new Set(usedBy.filter((from) => unused.has(edgeKey(from, path)))),
  };
}

/**
 * Dependency index from the server: of the working tree, or of branch `ref` while comparing.
 * Refetched when `cityKey` changes (a rescan replaces the working-tree city).
 */
export function useDeps(cityKey, ref = null) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!cityKey) return undefined;
    let cancelled = false;
    setData(null);
    fetch(ref ? `/api/deps?ref=${encodeURIComponent(ref)}` : "/api/deps")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => !cancelled && d && setData(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cityKey, ref]);
  return useMemo(() => (data ? { ...indexDeps(unpackDeps(data)), truncated: data.truncated } : null), [data]);
}
