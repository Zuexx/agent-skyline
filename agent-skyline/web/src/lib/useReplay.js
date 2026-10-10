import { useEffect, useMemo, useState } from "react";
import { activityAt, feedRange } from "./replay.js";

const TICK_MS = 100;

/**
 * Replay controls over the live feed. While active, `activity` is the session as of `t`
 * (see replay.js); otherwise null and the caller shows live activity.
 */
export function useReplay(feed) {
  const [active, setActive] = useState(false);
  const [t, setT] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const range = useMemo(() => feedRange(feed), [feed]);

  useEffect(() => {
    if (!active || !playing || !range) return undefined;
    const timer = setInterval(() => {
      setT((cur) => {
        const next = Math.min((cur ?? range[0]) + TICK_MS * speed, range[1]);
        if (next >= range[1]) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, playing, speed, range]);

  const activity = useMemo(
    () => (active && t != null ? activityAt(feed, t, Date.now()) : null),
    // Recomputed per tick (t), not per new live event: a replay is a fixed history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, t]
  );

  return {
    active,
    t,
    playing,
    speed,
    range,
    activity,
    start: () => {
      if (!range) return;
      setActive(true);
      setT(range[0]);
      setPlaying(true);
    },
    stop: () => {
      setActive(false);
      setPlaying(false);
      setT(null);
    },
    toggle: () => {
      if (range && t != null && t >= range[1]) setT(range[0]); // replay again from the start
      setPlaying((p) => !p);
    },
    seek: (ms) => setT(ms),
    setSpeed,
  };
}
