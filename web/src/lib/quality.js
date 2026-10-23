// Post-processing quality levels (specs/06-themes.md, Budgets): high = tilt-shift + bloom +
// vignette, medium = bloom only, low = none. A pack names where to start; when frames stay slow the
// level steps down, and it never steps back up within the session. Pure.

export const LEVELS = ["high", "medium", "low"];
export const SLOW_FRAME_MS = 20; // average frame time above this counts as slow
export const SLOW_FOR_MS = 3000; // ...for this long before stepping down

/** A frame-time watcher: feed it frame durations (ms); `level` steps down after a slow stretch. */
export function createQualityGovernor(start = "high", { slowMs = SLOW_FRAME_MS, slowFor = SLOW_FOR_MS, window = 500 } = {}) {
  let level = LEVELS.includes(start) ? start : "high";
  let winSum = 0;
  let winCount = 0;
  let winTime = 0;
  let slowTime = 0;
  return {
    get level() {
      return level;
    },
    /** Add one frame; returns true when the level just changed. */
    frame(ms) {
      winSum += ms;
      winCount++;
      winTime += ms;
      if (winTime < window) return false;
      const avg = winSum / winCount;
      slowTime = avg > slowMs ? slowTime + winTime : 0;
      winSum = winCount = winTime = 0;
      if (slowTime < slowFor || level === "low") return false;
      level = LEVELS[LEVELS.indexOf(level) + 1];
      slowTime = 0;
      return true;
    },
  };
}
