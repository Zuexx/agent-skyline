import { useEffect, useState } from "react";

/** The current time in ms, refreshed every `ms` (for "5 min ago" style labels). */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
