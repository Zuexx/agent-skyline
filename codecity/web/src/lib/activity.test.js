import { describe, it, expect } from "vitest";
import {
  emptyActivity,
  applyEvent,
  agentKeyOf,
  agentNumber,
  agentColorIndex,
  buildingTint,
  formatClock,
  formatAgo,
  splitPath,
  FEED_MAX,
} from "./activity.js";

const T0 = Date.parse("2026-10-09T08:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

function ev(over = {}) {
  return {
    ts: iso(T0),
    session: "s1",
    agent: null,
    event: "PostToolUse",
    tool: "Edit",
    kind: "read",
    paths: ["a/b.cs"],
    detail: null,
    ...over,
  };
}

describe("applyEvent", () => {
  it("ignores 'other' events and read/write/blocked events without paths", () => {
    const s = emptyActivity();
    expect(applyEvent(s, ev({ kind: "other" }))).toBe(s);
    expect(applyEvent(s, ev({ paths: [] }))).toBe(s);
    expect(applyEvent(s, ev({ paths: undefined }))).toBe(s);
  });

  it("puts exec and search events in the feed without touching files or agents", () => {
    let s = applyEvent(emptyActivity(), ev({ kind: "exec", paths: [], detail: "grep -n jwks api" }));
    s = applyEvent(s, ev({ kind: "search", paths: [], detail: "*.cs" }));
    expect(s.feed.map((e) => e.kind)).toEqual(["search", "exec"]);
    expect(s.files).toEqual({});
    expect(s.agents).toEqual({});
  });

  it("counts files named by a command (readPaths) as reads and moves the agent there", () => {
    const s = applyEvent(emptyActivity(), ev({ kind: "exec", paths: [], detail: "cat a/b.cs", readPaths: ["a/b.cs"] }));
    expect(s.feed[0].kind).toBe("exec"); // still shown as a command
    expect(s.files["a/b.cs"]).toMatchObject({ reads: 1, lastRead: iso(T0) });
    expect(s.agents["s1"]).toMatchObject({ path: "a/b.cs", kind: "read" });
  });

  it("collapses an immediate repeat into one feed row with a count", () => {
    let s = emptyActivity();
    for (let i = 0; i < 3; i++) s = applyEvent(s, ev({ ts: iso(T0 + i) }));
    s = applyEvent(s, ev({ ts: iso(T0 + 9), paths: ["other.cs"] }));
    expect(s.feed).toHaveLength(2);
    expect(s.feed[1]).toMatchObject({ repeat: 3, ts: iso(T0 + 2) });
    expect(s.files["a/b.cs"].reads).toBe(3); // counts are not collapsed
  });

  it("numbers agents per source, so labels read Claude 1, Claude 2, pi 1", () => {
    let s = applyEvent(emptyActivity(), ev({ session: "c1" }));
    s = applyEvent(s, ev({ session: "p1", source: "pi" }));
    s = applyEvent(s, ev({ session: "c2", source: "claude-code" }));
    expect(["c1", "p1", "c2"].map((k) => [agentNumber(s, k), s.agentSource[k]])).toEqual([
      [1, "claude-code"],
      [1, "pi"],
      [2, "claude-code"],
    ]);
  });

  it("numbers agents in order of first appearance", () => {
    let s = applyEvent(emptyActivity(), ev({ session: "zzz" }));
    s = applyEvent(s, ev({ session: "aaa", kind: "exec", paths: [] }));
    s = applyEvent(s, ev({ session: "zzz" }));
    expect(agentNumber(s, "zzz")).toBe(1);
    expect(agentNumber(s, "aaa")).toBe(2);
    expect(agentNumber(s, "nobody")).toBe(0);
  });

  it("counts reads, writes and blocked per path with ISO timestamps", () => {
    let s = emptyActivity();
    s = applyEvent(s, ev({ kind: "read" }));
    s = applyEvent(s, ev({ kind: "write", paths: ["a/b.cs", "c/d.cs"] }));
    s = applyEvent(s, ev({ kind: "blocked" }));

    expect(s.files["a/b.cs"]).toMatchObject({ reads: 1, writes: 1, blocked: 1 });
    expect(s.files["a/b.cs"].lastRead).toBe(iso(T0));
    expect(s.files["a/b.cs"].lastWrite).toBe(iso(T0));
    expect(s.files["a/b.cs"].lastBlocked).toBe(iso(T0));
    expect(s.files["c/d.cs"]).toMatchObject({ reads: 0, writes: 1, blocked: 0 });
    expect(Object.keys(s.files)).toHaveLength(2);
  });

  it("does not mutate the input state", () => {
    const s0 = applyEvent(emptyActivity(), ev({ kind: "read" }));
    const frozen = JSON.parse(JSON.stringify(s0));
    applyEvent(s0, ev({ kind: "write", paths: ["r/s.cs"] }));
    expect(s0).toEqual(frozen);
  });

  it("caps the feed at FEED_MAX entries, newest first", () => {
    let s = emptyActivity();
    const n = FEED_MAX + 10;
    for (let i = 0; i < n; i++) s = applyEvent(s, ev({ ts: iso(T0 + i), paths: [`f${i}.cs`] }));
    expect(s.feed).toHaveLength(FEED_MAX);
    expect(s.feed[0].ts).toBe(iso(T0 + n - 1)); // newest first
    expect(s.feed[FEED_MAX - 1].ts).toBe(iso(T0 + 10)); // oldest kept
  });

  it("tracks agents by last path, falling back to the session id", () => {
    let s = applyEvent(emptyActivity(), ev({ kind: "read" })); // agent null -> session "s1"
    expect(s.agents["s1"]).toEqual({ path: "a/b.cs", ts: iso(T0), kind: "read", source: "claude-code" });

    s = applyEvent(s, ev({ agent: "claude-2", kind: "write", paths: ["x/y.cs", "z/w.cs"] }));
    expect(s.agents["claude-2"]).toEqual({ path: "z/w.cs", ts: iso(T0), kind: "write", source: "claude-code" });

    s = applyEvent(s, ev({ agent: null, session: null, kind: "blocked" }));
    expect(agentKeyOf(ev({ agent: null, session: null }))).toBe("unknown");
    expect(s.agents["unknown"]).toBeDefined();
  });
});

describe("buildingTint", () => {
  const now = T0 + 100_000; // fixed "now" for boundary checks

  it("flags blocked within 3000 ms (2999 in, 3001 out)", () => {
    expect(buildingTint({ reads: 0, writes: 0, blocked: 1, lastBlocked: iso(now - 2999) }, now)).toBe("blocked");
    const stale = buildingTint({ reads: 0, writes: 0, blocked: 1, lastBlocked: iso(now - 3001) }, now);
    expect(stale).not.toBe("blocked");
    expect(stale).toBeNull(); // nothing else to fall back to
  });

  it("flags read within 4000 ms", () => {
    expect(buildingTint({ reads: 1, writes: 0, blocked: 0, lastRead: iso(now - 3999) }, now)).toBe("read");
    expect(buildingTint({ reads: 1, writes: 0, blocked: 0, lastRead: iso(now - 4001) }, now)).toBeNull();
  });

  it("keeps written once a file has been written", () => {
    expect(buildingTint({ reads: 0, writes: 2, blocked: 0, lastWrite: iso(now - 999_999) }, now)).toBe("written");
  });

  it("prefers blocked over read and read over written", () => {
    const base = { reads: 1, writes: 3, lastRead: iso(now - 100), lastWrite: iso(now - 50) };
    expect(buildingTint({ ...base, blocked: 1, lastBlocked: iso(now - 2999) }, now)).toBe("blocked");
    expect(buildingTint(base, now)).toBe("read"); // fresh read beats persistent written
  });

  it("returns null for unknown or empty files", () => {
    expect(buildingTint(undefined, now)).toBeNull();
    expect(buildingTint({ reads: 0, writes: 0, blocked: 0 }, now)).toBeNull();
  });
});

describe("agentColorIndex", () => {
  it("is stable and in range for any n", () => {
    for (const n of [1, 2, 6]) {
      const a = agentColorIndex("abc-123", n);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(n);
      expect(agentColorIndex("abc-123", n)).toBe(a); // stable across calls
    }
  });

  it("treats missing keys as unknown but still stays in range", () => {
    const a = agentColorIndex(undefined, 6);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(6);
    expect(agentColorIndex(null, 6)).toBe(a);
  });
});

describe("formatAgo and splitPath", () => {
  it("formats relative ages", () => {
    expect(formatAgo(iso(T0), T0 + 2000)).toBe("剛剛");
    expect(formatAgo(iso(T0), T0 + 12_000)).toBe("12 秒前");
    expect(formatAgo(iso(T0), T0 + 190_000)).toBe("3 分鐘前");
    expect(formatAgo(iso(T0), T0 + 7_300_000)).toBe("2 小時前");
    expect(formatAgo("nope", T0)).toBe("");
  });

  it("splits a path into file name and folder", () => {
    expect(splitPath("api/Anvil/Data/UnitOfWork.cs")).toEqual({ name: "UnitOfWork.cs", dir: "api/Anvil/Data" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", dir: "" });
  });
});

describe("formatClock", () => {
  it("formats ISO timestamps as local HH:MM:SS", () => {
    expect(formatClock(new Date(2026, 9, 9, 8, 5, 3).toISOString())).toBe("08:05:03");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(formatClock(null)).toBe("");
    expect(formatClock("not-a-date")).toBe("");
  });
});
