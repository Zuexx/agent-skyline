import { describe, expect, it } from "vitest";
import { agentsIn, GAP_MS, inRange, rangeFor, segmentSessions, startOfDay } from "./sessions.js";

const at = (iso, source) => ({ ts: iso, ...(source ? { source } : {}) });
const events = [
  at("2026-10-09T03:52:00Z"),
  at("2026-10-09T04:59:00Z", "watcher"),
  at("2026-10-09T12:16:00Z", "claude-code"),
  at("2026-10-09T13:30:00Z", "pi"),
  at("not a date"),
];

describe("segmentSessions", () => {
  it("starts a new session after two quiet hours", () => {
    const s = segmentSessions(events);
    expect(s.map((x) => [new Date(x.start).toISOString(), new Date(x.end).toISOString(), x.count])).toEqual([
      ["2026-10-09T03:52:00.000Z", "2026-10-09T04:59:00.000Z", 2],
      ["2026-10-09T12:16:00.000Z", "2026-10-09T13:30:00.000Z", 2],
    ]);
    expect(s[0].sources).toEqual(["claude-code", "watcher"]);
    expect(s[1].sources).toEqual(["claude-code", "pi"]);
  });

  it("keeps a gap of exactly the threshold in one session, and sorts unordered input", () => {
    const t0 = Date.parse("2026-10-09T00:00:00Z");
    const s = segmentSessions([at(new Date(t0 + GAP_MS).toISOString()), at(new Date(t0).toISOString())]);
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(2);
  });
});

describe("rangeFor", () => {
  const s = segmentSessions(events);
  const now = Date.parse("2026-10-09T14:00:00Z");

  it("defaults to the latest session, open-ended", () => {
    expect(rangeFor({ kind: "recent" }, s, now)).toEqual({ since: s[1].start, until: null });
    expect(rangeFor(undefined, s, now)).toEqual({ since: s[1].start, until: null });
  });

  it("closes a past session and treats the newest one as recent", () => {
    expect(rangeFor({ kind: "session", id: s[0].id }, s, now)).toEqual({ since: s[0].start, until: s[0].end });
    expect(rangeFor({ kind: "session", id: s[1].id }, s, now)).toEqual({ since: s[1].start, until: null });
    expect(rangeFor({ kind: "session", id: 12345 }, s, now)).toEqual({ since: s[1].start, until: null });
  });

  it("covers today, everything, and nothing before any event", () => {
    expect(rangeFor({ kind: "today" }, s, now)).toEqual({ since: startOfDay(now), until: null });
    expect(rangeFor({ kind: "all" }, s, now)).toEqual({ since: null, until: null });
    expect(rangeFor({ kind: "recent" }, [], now)).toEqual({ since: Infinity, until: null });
  });
});

describe("agents", () => {
  const evs = [
    { ts: "2026-10-09T12:00:00Z", session: "c-a" },
    { ts: "2026-10-09T12:01:00Z", session: "p-a", source: "pi" },
    { ts: "2026-10-09T12:02:00Z", session: "c-b" },
    { ts: "2026-10-09T12:03:00Z", session: "c-a" },
    { ts: "2026-10-09T09:00:00Z", session: "c-old" },
  ];
  const range = { since: Date.parse("2026-10-09T11:00:00Z"), until: null };

  it("are numbered per source within the time range", () => {
    expect(agentsIn(evs, range)).toEqual([
      { key: "c-a", source: "claude-code", n: 1, count: 2 },
      { key: "p-a", source: "pi", n: 1, count: 1 },
      { key: "c-b", source: "claude-code", n: 2, count: 1 },
    ]);
  });

  it("keep their numbers when the range is narrowed to one of them", () => {
    expect(agentsIn(evs, { ...range, agent: "c-b" }).find((a) => a.key === "c-b").n).toBe(2);
    expect(evs.filter((e) => inRange(e, { ...range, agent: "c-a" }))).toHaveLength(2);
  });
});

describe("inRange", () => {
  it("filters by time, letting undated events through only when unbounded", () => {
    const r = { since: Date.parse("2026-10-09T12:00:00Z"), until: null };
    expect(events.filter((e) => inRange(e, r))).toHaveLength(2);
    expect(events.filter((e) => inRange(e, { since: null, until: null }))).toHaveLength(5);
    expect(inRange(events[0], { since: Infinity, until: null })).toBe(false);
  });
});
