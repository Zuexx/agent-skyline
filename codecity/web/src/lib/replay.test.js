import { describe, it, expect } from "vitest";
import { activityAt, feedRange, timelineMarks } from "./replay.js";

const T = Date.parse("2026-10-09T08:00:00.000Z");
const ev = (dt, kind, path) => ({ ts: new Date(T + dt).toISOString(), session: "s", kind, paths: [path] });
// newest-first, like activity.feed
const feed = [ev(3000, "blocked", "c.ts"), ev(2000, "write", "b.ts"), ev(1000, "read", "a.ts")];

describe("replay", () => {
  it("knows the time span of the feed", () => {
    expect(feedRange(feed)).toEqual([T + 1000, T + 3000]);
    expect(feedRange([])).toBeNull();
  });

  it("rebuilds the activity as of a moment, shifted so that moment reads as now", () => {
    const now = T + 60_000;
    const s = activityAt(feed, T + 2000, now);
    expect(Object.keys(s.files).sort()).toEqual(["a.ts", "b.ts"]); // c.ts was blocked later
    expect(s.files["b.ts"].lastWrite).toBe(new Date(now).toISOString()); // T+2000 -> now
    expect(s.files["a.ts"].lastRead).toBe(new Date(now - 1000).toISOString());
    expect(s.feed.map((e) => e.paths[0])).toEqual(["b.ts", "a.ts"]);
  });

  it("marks writes and blocks along the track", () => {
    expect(timelineMarks(feed, feedRange(feed))).toEqual([
      { at: 1, kind: "blocked" },
      { at: 0.5, kind: "write" },
    ]);
  });
});
