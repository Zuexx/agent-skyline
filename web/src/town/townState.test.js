import { describe, it, expect } from "vitest";
import { buildingOf, townState, ACTIVE_MS, RECENT_MS } from "./townState.js";

const IDS = ["(root)", "web/src/city", "web/src/lib", "web", "specs", "install"];
const NOW = Date.parse("2026-10-23T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

describe("buildingOf", () => {
  it("picks the deepest building that holds the path", () => {
    expect(buildingOf("web/src/city/Agents.jsx", IDS)).toBe("web/src/city");
    expect(buildingOf("web/src/ui/x.jsx", IDS)).toBe("web");
    expect(buildingOf("specs/09.md", IDS)).toBe("specs");
  });
  it("does not match a folder that only shares a prefix", () => {
    expect(buildingOf("specsx/a.md", IDS)).toBe("(root)");
  });
  it("puts files outside every building in the town hall", () => {
    expect(buildingOf("README.md", IDS)).toBe("(root)");
    expect(buildingOf("proto/a.js", IDS)).toBe("(root)");
  });
  it("ignores paths outside the repo", () => {
    expect(buildingOf("/etc/hosts", IDS)).toBeNull();
    expect(buildingOf("C:/Users/x", IDS)).toBeNull();
    expect(buildingOf("", IDS)).toBeNull();
    expect(buildingOf(null, IDS)).toBeNull();
  });
});

describe("townState", () => {
  it("gives characters by order of first appearance and maps kinds to actions", () => {
    const activity = {
      agents: {
        a: { path: "web/src/city/x.js", ts: ago(1000), kind: "write" },
        b: { path: "specs/09.md", ts: ago(1000), kind: "read" },
        c: { path: "install/x.sh", ts: ago(1000), kind: "blocked" },
        d: { path: "web/src/lib/y.js", ts: ago(1000), kind: "write" },
      },
      files: {},
    };
    const s = townState(activity, { a: 1, b: 2, c: 3, d: 4 }, IDS, NOW);
    expect(s.agents).toEqual([
      { key: "a", character: "hero", building: "web/src/city", action: "write" },
      { key: "b", character: "mage", building: "specs", action: "read" },
      { key: "c", character: "priest", building: "install", action: "blocked" },
      { key: "d", character: "hero", building: "web/src/lib", action: "write" },
    ]);
  });
  it("sends quiet agents home", () => {
    const activity = { agents: { a: { path: "specs/a.md", ts: ago(ACTIVE_MS + 1), kind: "write" } }, files: {} };
    expect(townState(activity, { a: 1 }, IDS, NOW).agents[0].action).toBe("idle");
  });
  it("lists buildings written to recently, once each", () => {
    const activity = {
      agents: {},
      files: {
        "specs/a.md": { lastWrite: ago(1000) },
        "specs/b.md": { lastWrite: ago(2000) },
        "web/src/lib/c.js": { lastWrite: ago(RECENT_MS + 1) },
        "install/d.sh": { lastWrite: null },
        "/tmp/e": { lastWrite: ago(1000) },
      },
    };
    expect(townState(activity, {}, IDS, NOW).recent).toEqual(["specs"]);
  });
  it("copes with an empty activity", () => {
    expect(townState(null, null, IDS, NOW)).toEqual({ agents: [], recent: [] });
  });
});
