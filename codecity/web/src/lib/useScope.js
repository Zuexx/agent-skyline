import { useCallback, useEffect, useRef, useState } from "react";
import { toggleDistrictGlob } from "./zones.js";

/**
 * Declared task scope from the server ({ allow: globs }). Empty = nothing declared, and the scope
 * check infers from the session instead. `toggleDistrict(path)` adds or removes "<path>/**".
 */
export function useScope(url = "/api/scope") {
  const [allow, setAllow] = useState([]);
  const [error, setError] = useState(null);
  const ref = useRef(allow);
  ref.current = allow;

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((s) => !cancelled && setAllow(s.allow ?? []))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const save = useCallback(
    async (next) => {
      try {
        const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow: next }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setAllow(body.allow ?? []);
        setError(null);
      } catch (e) {
        setError(e.message);
      }
    },
    [url]
  );

  const toggleDistrict = useCallback(
    (path) => {
      const next = toggleDistrictGlob(ref.current, path);
      if (next !== ref.current) save(next);
    },
    [save]
  );

  return { allow, error, toggleDistrict, set: save, clear: () => save([]) };
}
