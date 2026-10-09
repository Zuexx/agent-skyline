import { useEffect, useMemo, useState } from "react";
import { roleOf } from "./views.js";

/** Index edges [[from, to]] both ways: uses (from -> its targets) and usedBy (to -> its users). */
export function indexDeps(edges = []) {
  const uses = new Map();
  const usedBy = new Map();
  const add = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  for (const [from, to] of edges) {
    add(uses, from, to);
    add(usedBy, to, from);
  }
  for (const m of [uses, usedBy]) for (const list of m.values()) list.sort();
  return { uses, usedBy };
}

/** What one file uses, what uses it, and which of those users are tests. */
export function depsOf(index, path) {
  const uses = index?.uses.get(path) ?? [];
  const usedBy = index?.usedBy.get(path) ?? [];
  return { uses, usedBy: usedBy.filter((p) => roleOf(p) !== "test"), testedBy: usedBy.filter((p) => roleOf(p) === "test") };
}

/** Working-tree dependency index from the server; refetched when the city is rescanned. */
export function useDeps(cityKey) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!cityKey) return undefined;
    let cancelled = false;
    fetch("/api/deps")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => !cancelled && d && setData(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cityKey]);
  return useMemo(() => (data ? { ...indexDeps(data.edges), truncated: data.truncated } : null), [data]);
}
