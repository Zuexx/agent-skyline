import { useEffect, useState } from "react";

const getJson = (url) =>
  fetch(url).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });

/**
 * Uncommitted changes in the working tree (against HEAD), as a Map path -> change. Refetched,
 * shortly after the fact, whenever `version` changes (the number of writes seen so far), so the
 * list follows the agent without polling.
 */
export function useWorking(version, delayMs = 800) {
  const [changes, setChanges] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      getJson("/api/working")
        .then((w) => !cancelled && setChanges(new Map(w.files.map((f) => [f.path, f]))))
        .catch(() => {});
    }, changes ? delayMs : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return changes;
}

/** One file's uncommitted diff. */
export function fetchWorkingDiff(path) {
  return getJson(`/api/working/file?${new URLSearchParams({ path })}`);
}
