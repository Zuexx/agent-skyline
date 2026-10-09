import { describe, it, expect } from "vitest";
import { areaOf, computeWarnings, warningKey } from "./scope.js";

let clock = 0;
const ev = (kind, path, extra = {}) => ({
  ts: new Date(Date.UTC(2026, 9, 9, 8, 0, clock++)).toISOString(),
  session: "s1",
  kind,
  paths: path ? [path] : [],
  ...extra,
});
// Activity keeps the feed newest-first; tests write it oldest-first for readability.
const feedOf = (...events) => events.reverse();
const rules = (warnings) => [...warnings.values()].map((w) => [w.rule, w.path]);

describe("areaOf", () => {
  it("uses the first two folder levels", () => {
    expect(areaOf("api/Anvil/Data/UnitOfWork.cs")).toBe("api/Anvil");
    expect(areaOf("app/x.ts")).toBe("app");
    expect(areaOf("README.md")).toBe("");
  });
});

describe("computeWarnings without a declared scope", () => {
  const known = new Set(["api/Anvil/a.cs", "api/Anvil/b.cs", "app/lib/c.ts", "docs/d.md"]);

  it("flags a write to an existing file the agent never read", () => {
    const w = computeWarnings(feedOf(ev("read", "api/Anvil/a.cs"), ev("write", "api/Anvil/b.cs")), { known });
    expect(rules(w)).toEqual([["blindWrite", "api/Anvil/b.cs"]]);
  });

  it("does not flag new files, or files read through a shell command", () => {
    const w = computeWarnings(
      feedOf(ev("write", "api/Anvil/new.cs"), ev("exec", null, { readPaths: ["api/Anvil/b.cs"] }), ev("write", "api/Anvil/b.cs")),
      { known }
    );
    expect(rules(w)).toEqual([]);
  });

  it("flags a write into an untouched area once the agent has settled", () => {
    const settled = [1, 2, 3, 4, 5].map(() => ev("read", "api/Anvil/a.cs"));
    const w = computeWarnings(feedOf(...settled, ev("read", "app/lib/c.ts"), ev("write", "docs/new.md")), { known });
    expect(rules(w)).toEqual([["newArea", "docs/new.md"]]);
  });

  it("does not call an area new before the agent has settled", () => {
    const w = computeWarnings(feedOf(ev("read", "api/Anvil/a.cs"), ev("write", "docs/new.md")), { known });
    expect(rules(w)).toEqual([]);
  });

  it("tracks agents separately and keys warnings to their feed entry", () => {
    const a = ev("read", "api/Anvil/a.cs", { session: "A" });
    const b = ev("write", "api/Anvil/a.cs", { session: "B" });
    const w = computeWarnings(feedOf(a, b), { known });
    expect([...w.keys()]).toEqual([warningKey(b, "api/Anvil/a.cs")]);
    expect(w.get(warningKey(b, "api/Anvil/a.cs")).agent).toBe("B");
  });
});

describe("computeWarnings and the file watcher", () => {
  it("never judges watcher events, which have no reads to compare against", () => {
    const w = computeWarnings(feedOf(ev("write", "api/Anvil/a.cs", { source: "watcher", session: "watcher" })), {
      known: new Set(["api/Anvil/a.cs"]),
    });
    expect(rules(w)).toEqual([]);
  });
});

describe("computeWarnings with a declared scope", () => {
  it("flags only writes outside the declared globs", () => {
    const w = computeWarnings(feedOf(ev("write", "api/Anvil/x.cs"), ev("write", "app/y.ts")), {
      declared: ["api/**"],
      known: new Set(),
    });
    expect(rules(w)).toEqual([["outOfScope", "app/y.ts"]]);
  });
});
