import { useEffect, useState } from "react";

// Which files were already looked at, per comparison (or "live" for the working session). Shared:
// every component using the same key sees the same ticks (the review panel ticks them, the town
// takes the warning flags down). Browser storage is a convenience only: if it is unavailable, the
// ticks simply do not persist.
const listeners = new Map(); // storage key -> Set of setters
const memory = new Map(); // storage key -> Set of paths (the truth; storage only keeps it across loads)

function load(storageKey) {
  if (!memory.has(storageKey)) {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    } catch {
      // storage blocked or unreadable: start empty
    }
    memory.set(storageKey, new Set(Array.isArray(saved) ? saved : []));
  }
  return new Set(memory.get(storageKey));
}

/** { done: Set of reviewed paths, toggle(path) } for `scopeKey`. */
export function useReviewed(scopeKey) {
  const storageKey = `agent-skyline.reviewed.${scopeKey}`;
  const [done, setDone] = useState(() => load(storageKey));
  useEffect(() => {
    setDone(load(storageKey));
    if (!listeners.has(storageKey)) listeners.set(storageKey, new Set());
    const set = listeners.get(storageKey);
    set.add(setDone);
    return () => set.delete(setDone);
  }, [storageKey]);
  const toggle = (path) => {
    const next = load(storageKey);
    next.has(path) ? next.delete(path) : next.add(path);
    memory.set(storageKey, next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // storage blocked: the ticks last for this page only
    }
    for (const s of listeners.get(storageKey) ?? []) s(new Set(next));
  };
  return { done, toggle };
}
