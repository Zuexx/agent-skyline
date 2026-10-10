import { describe, expect, it } from "vitest";
import { computeConflicts } from "./conflicts.js";

const w = (min, session, path, source = "claude-code") => ({
  ts: new Date(Date.UTC(2026, 9, 9, 12, min)).toISOString(),
  kind: "write",
  session,
  source,
  paths: [path],
});
const newestFirst = (...evs) => evs.reverse();

describe("computeConflicts", () => {
  it("flags a second agent writing the same file within ten minutes", () => {
    const m = computeConflicts(newestFirst(w(0, "claude-1", "a.ts"), w(4, "pi-1", "a.ts", "pi")));
    expect([...m.values()]).toEqual([
      { rule: "conflict", path: "a.ts", agent: "pi-1", ts: w(4, "", "").ts, other: "claude-1", otherSource: "claude-code" },
    ]);
  });

  it("ignores the same agent, other files, old writes and the file watcher", () => {
    expect(computeConflicts(newestFirst(w(0, "c1", "a.ts"), w(1, "c1", "a.ts"))).size).toBe(0);
    expect(computeConflicts(newestFirst(w(0, "c1", "a.ts"), w(1, "c2", "b.ts"))).size).toBe(0);
    expect(computeConflicts(newestFirst(w(0, "c1", "a.ts"), w(11, "c2", "a.ts"))).size).toBe(0);
    expect(computeConflicts(newestFirst(w(0, "watcher", "a.ts", "watcher"), w(1, "c2", "a.ts"))).size).toBe(0);
  });

  it("compares with the latest writer, so back-and-forth is flagged each time", () => {
    const m = computeConflicts(newestFirst(w(0, "c1", "a.ts"), w(2, "c2", "a.ts"), w(3, "c1", "a.ts")));
    expect([...m.values()].map((x) => [x.agent, x.other])).toEqual([
      ["c2", "c1"],
      ["c1", "c2"],
    ]);
  });
});
