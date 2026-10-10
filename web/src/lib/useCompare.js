import { useEffect, useState } from "react";

const getJson = (url) =>
  fetch(url).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });

/** Pick the base to compare against: main, else master, else the current branch. */
function defaultBase(branches, current) {
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return current ?? branches[0] ?? null;
}

/**
 * Branch comparison. `head` null = not comparing. When set, loads the head branch's city (with the
 * files it deleted kept as buildings) and the diff against `base`, as a Map path -> change.
 */
export function useCompare() {
  const [branches, setBranches] = useState([]);
  const [base, setBase] = useState(null);
  const [head, setHead] = useState(null);
  const [city, setCity] = useState(null);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJson("/api/branches")
      .then((b) => {
        setBranches(b.branches ?? []);
        setBase((cur) => cur ?? defaultBase(b.branches ?? [], b.current));
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!head || !base) {
      setCity(null);
      setDiff(null);
      return undefined;
    }
    let cancelled = false;
    const q = `base=${encodeURIComponent(base)}`;
    Promise.all([
      getJson(`/api/city?ref=${encodeURIComponent(head)}&${q}`),
      getJson(`/api/diff?${q}&head=${encodeURIComponent(head)}`),
    ])
      .then(([c, d]) => {
        if (cancelled) return;
        setCity(c);
        setDiff(new Map(d.files.map((f) => [f.path, f])));
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [base, head]);

  const files = diff ? [...diff.values()] : [];
  const summary = diff
    ? {
        files: files.length,
        added: files.reduce((n, f) => n + (f.added ?? 0), 0),
        removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
      }
    : null;

  return { branches, base, setBase, head, setHead, city, diff, summary, error, active: Boolean(head && city && diff) };
}

/** One file's unified diff on head since base. */
export function fetchFileDiff(base, head, path) {
  const q = new URLSearchParams({ base, head, path });
  return getJson(`/api/diff/file?${q}`);
}
