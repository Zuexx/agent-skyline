import { describe, it, expect } from "vitest";
import { alertsFrom, freshAlerts, FRESH_MS } from "./alerts.js";
import { warningKey } from "./scope.js";

const T = Date.parse("2026-10-09T08:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

describe("alertsFrom", () => {
  it("turns blocked events and flagged writes into alerts, newest first", () => {
    const write = { ts: iso(T + 2000), session: "s", kind: "write", paths: ["docs/x.md"] };
    const blocked = { ts: iso(T + 1000), session: "s", kind: "blocked", paths: ["locked/a.ts"], detail: "codecity: …", source: "pi" };
    const read = { ts: iso(T), session: "s", kind: "read", paths: ["a.ts"] };
    const warnings = new Map([[warningKey(write, "docs/x.md"), { rule: "newArea", agent: "s" }]]);
    const alerts = alertsFrom([write, blocked, read], warnings);
    expect(alerts.map((a) => [a.level, a.rule, a.path, a.source])).toEqual([
      ["warn", "newArea", "docs/x.md", "claude-code"],
      ["block", "blocked", "locked/a.ts", "pi"],
    ]);
  });
});

describe("done alerts", () => {
  it("summarize what each agent's turn changed, from its previous stop", () => {
    const ev = (s, kind, sec, path) => ({ ts: iso(T + sec * 1000), session: s, kind, paths: path ? [path] : [] });
    // Oldest first, then reversed into the feed's newest-first order.
    const oldestFirst = [
      ev("c1", "write", 1, "old.ts"),
      ev("c1", "stop", 2),
      ev("c1", "write", 3, "a.ts"),
      ev("p1", "write", 4, "pi.ts"),
      ev("c1", "write", 5, "a.ts"),
      ev("c1", "write", 6, "b.ts"),
      ev("c1", "blocked", 7, "locked.ts"),
      ev("c1", "stop", 8),
    ];
    const warnings = new Map([[warningKey(oldestFirst[5], "b.ts"), { rule: "newArea", agent: "c1" }]]);
    const done = alertsFrom([...oldestFirst].reverse(), warnings).filter((a) => a.level === "done");
    expect(done.map((a) => [a.agent, a.summary])).toEqual([
      ["c1", { written: ["a.ts", "b.ts"], warned: 1, blocked: 1 }],
      ["c1", { written: ["old.ts"], warned: 0, blocked: 0 }],
    ]);
  });

  it("carry the other agent of a conflict", () => {
    const write = { ts: iso(T), session: "p1", kind: "write", paths: ["a.ts"], source: "pi" };
    const warnings = new Map([[warningKey(write, "a.ts"), { rule: "conflict", agent: "p1", other: "c1", otherSource: "claude-code" }]]);
    const [a] = alertsFrom([write], warnings);
    expect([a.rule, a.other, a.otherSource]).toEqual(["conflict", "c1", "claude-code"]);
  });
});

describe("freshAlerts", () => {
  it("announces each alert once, and only while it is fresh", () => {
    const seen = new Set();
    const fresh = { key: "a", ts: iso(T) };
    const stale = { key: "b", ts: iso(T - FRESH_MS - 1) };
    expect(freshAlerts([fresh, stale], seen, T + 100).map((a) => a.key)).toEqual(["a"]);
    expect(freshAlerts([fresh, stale], seen, T + 200)).toEqual([]); // already seen
  });
});
