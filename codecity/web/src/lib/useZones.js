import { useCallback, useEffect, useRef, useState } from "react";
import { toggleDistrictGlob } from "./zones.js";

/**
 * Locked zones from the server. `toggleDistrict(path)` adds or removes "<path>/**" and PUTs the
 * whole list; on failure the previous list stays and `error` explains why.
 */
export function useZones(url = "/api/zones") {
  const [locked, setLocked] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((z) => {
        if (cancelled) return;
        setLocked(z.locked ?? []);
        setStatus(z.status);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const toggleDistrict = useCallback(
    async (path) => {
      const next = toggleDistrictGlob(lockedRef.current, path);
      if (next === lockedRef.current) return;
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked: next }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setLocked(body.locked ?? []);
        setStatus(body.status);
        setError(null);
      } catch (err) {
        setError(err.message);
      }
    },
    [url]
  );

  return { locked, status, error, toggleDistrict };
}
