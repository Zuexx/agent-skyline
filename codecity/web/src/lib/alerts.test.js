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

describe("freshAlerts", () => {
  it("announces each alert once, and only while it is fresh", () => {
    const seen = new Set();
    const fresh = { key: "a", ts: iso(T) };
    const stale = { key: "b", ts: iso(T - FRESH_MS - 1) };
    expect(freshAlerts([fresh, stale], seen, T + 100).map((a) => a.key)).toEqual(["a"]);
    expect(freshAlerts([fresh, stale], seen, T + 200)).toEqual([]); // already seen
  });
});
