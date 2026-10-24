import { describe, it, expect } from "vitest";
import { buildingOf, searchedBuildings, townState, ACTIVE_MS, GONE_MS, RECENT_MS } from "./townState.js";

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
    expect(s.agents.map(({ key, character, building, action }) => ({ key, character, building, action }))).toEqual([
      { key: "a", character: "hero", building: "web/src/city", action: "write" },
      { key: "b", character: "mage", building: "specs", action: "read" },
      { key: "c", character: "priest", building: "install", action: "blocked" },
      { key: "d", character: "hero", building: "web/src/lib", action: "write" },
    ]);
  });
  it("gives the file watcher no character", () => {
    const activity = { agents: { w: { path: "specs/a.md", ts: ago(1000), kind: "write", source: "watcher" } }, files: {} };
    expect(townState(activity, { w: 1 }, IDS, NOW).agents).toEqual([]);
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
    expect(townState(null, null, IDS, NOW)).toEqual({ agents: [], recent: [], tests: {}, conflicts: [] });
  });
  it("lets agents quiet for ten minutes leave", () => {
    const activity = { agents: { a: { path: "specs/a.md", ts: ago(GONE_MS + 1), kind: "write" } }, files: {} };
    expect(townState(activity, { a: 1 }, IDS, NOW).agents).toEqual([]);
  });
});

// feed entries are newest first, like lib/activity.js keeps them
const ev = (kind, ms, more = {}) => ({ agent: "a", kind, ts: ago(ms), paths: [], ...more });
const withFeed = (feed, agents = {}) => ({ agents, files: {}, feed });

describe("townState from the feed", () => {
  it("casts on a shell command, but reads when the command reads a file", () => {
    let s = townState(withFeed([ev("exec", 1000, { detail: "ls" })]), { a: 1 }, IDS, NOW);
    expect(s.agents[0]).toMatchObject({ action: "cast", cast: NOW - 1000, building: "(root)" });
    s = townState(
      withFeed([ev("exec", 1000, { readPaths: ["specs/a.md"] })], { a: { path: "specs/a.md", ts: ago(1000), kind: "read" } }),
      { a: 1 },
      IDS,
      NOW
    );
    expect(s.agents[0]).toMatchObject({ action: "read", cast: null, building: "specs" });
  });
  it("searches the folder named and the buildings inside it", () => {
    const s = townState(withFeed([ev("search", 500, { paths: ["web/src"] })]), { a: 1 }, IDS, NOW);
    expect(s.agents[0].action).toBe("search");
    expect(s.agents[0].search).toEqual({ at: NOW - 500, buildings: ["web/src/city", "web/src/lib", "web"] });
    expect(searchedBuildings(undefined, IDS)).toEqual(IDS);
  });
  it("waits after a Stop until the next prompt, and cheers when the turn wrote something", () => {
    const feed = [ev("stop", 1000), ev("write", 2000, { paths: ["specs/a.md"] }), ev("stop", 9000), ev("read", 9500)];
    let s = townState(withFeed(feed), { a: 1 }, IDS, NOW);
    expect(s.agents[0]).toMatchObject({ action: "wait", cheer: NOW - 1000 });
    s = townState(withFeed(feed), { a: 1 }, IDS, NOW, { a: { at: NOW - 500 } });
    expect(s.agents[0].action).toBe("idle");
    // a turn with reads only: no cheer
    s = townState(withFeed([ev("stop", 1000), ev("read", 2000), ev("stop", 3000), ev("write", 4000)]), { a: 1 }, IDS, NOW);
    expect(s.agents[0].cheer).toBeNull();
    // still waiting long after the Stop
    s = townState(withFeed([ev("stop", ACTIVE_MS + 1000)]), { a: 1 }, IDS, NOW);
    expect(s.agents[0].action).toBe("wait");
  });
  it("shows the newest test result on the test folder, or on the building the command names", () => {
    const feed = [
      ev("exec", 1000, { check: true, outcome: "failed" }),
      ev("exec", 2000, { check: true, outcome: "passed" }),
      ev("exec", 3000, { check: true, outcome: "passed", readPaths: ["specs/a.md"] }),
    ];
    const s = townState(withFeed(feed), { a: 1 }, [...IDS, "test"], NOW);
    expect(s.tests).toEqual({ test: { outcome: "failed", at: NOW - 1000 }, specs: { outcome: "passed", at: NOW - 3000 } });
  });
  it("marks a building where two agents wrote the same file", () => {
    const feed = [ev("write", 1000, { agent: "b", paths: ["specs/a.md"] }), ev("write", 2000, { paths: ["specs/a.md"] })];
    expect(townState(withFeed(feed), { a: 1, b: 2 }, IDS, NOW).conflicts).toEqual([{ building: "specs", at: NOW - 1000 }]);
  });
  it("leaves the file watcher out of the feed too", () => {
    expect(townState(withFeed([ev("exec", 1000, { source: "watcher" })]), {}, IDS, NOW).agents).toEqual([]);
  });
});
