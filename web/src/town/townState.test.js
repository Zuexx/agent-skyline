import { describe, it, expect } from "vitest";
import { buildingModes, buildingOf, houseStates, prioritize, searchedBuildings, townState, ACTIVE_MS, GONE_MS, RECENT_MS, SUB_GONE_MS } from "./townState.js";

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

describe("houseStates", () => {
  it("counts uncommitted changes per building and grades the scaffold", () => {
    const working = new Map([
      ["specs/a.md", {}],
      ["specs/b.md", {}],
      ["specs/c.md", {}],
      ["install/x.sh", {}],
      ...Array.from({ length: 10 }, (_, i) => [`web/src/lib/f${i}.js`, {}]),
    ]);
    const h = houseStates(IDS, { working });
    expect(h.specs).toEqual({ changes: 3, level: 2, added: 0, deleted: 0, big: false, locked: false, scope: false, warn: 0, hot: 0, pillar: 0 });
    expect(h.install.level).toBe(1);
    expect(h["web/src/lib"].level).toBe(3);
    expect(h["web/src/lib"].big).toBe(true);
    expect(h.web).toBeUndefined();
  });
  it("puts new and moved files on the tent, deleted ones on the rubble, the rest on the scaffold", () => {
    const working = new Map([
      ["specs/a.md", { status: "A" }],
      ["specs/b.md", { status: "R" }],
      ["specs/c.md", { status: "D" }],
      ["specs/d.md", { status: "M" }],
      ...Array.from({ length: 10 }, (_, i) => [`install/n${i}.sh`, { status: "A" }]),
    ]);
    const h = houseStates(IDS, { working });
    expect(h.specs).toMatchObject({ changes: 4, added: 2, deleted: 1, level: 1, big: false });
    // ten new files: a big change (the crane) with no scaffold
    expect(h.install).toMatchObject({ added: 10, level: 0, big: true });
  });
  it("marks the most changed buildings as hotspots, summed over their files", () => {
    const churn = { "specs/a.md": 6, "specs/b.md": 6, "install/x.sh": 30, "web/a.js": 3, "web/src/lib/a.js": 11, "web/src/city/a.js": 10 };
    const h = houseStates(IDS, { churn });
    expect(h.install.hot).toBe(30);
    expect(h.specs.hot).toBe(12);
    expect(h["web/src/lib"].hot).toBe(11);
    expect(h["web/src/city"]).toBeUndefined(); // fourth: only the top three
    expect(h.web).toBeUndefined(); // below the minimum
  });
  it("raises the flagpole on buildings many files of other buildings use", () => {
    const usedBy = new Map([
      ["web/src/lib/a.js", ["web/src/city/1.js", "web/src/city/2.js", "web/x.js", "specs/s.md", "install/i.sh", "web/src/lib/b.js"]],
      ["web/src/lib/b.js", ["web/src/city/1.js"]],
      ["specs/a.md", ["web/x.js", "web/y.js"]],
    ]);
    const h = houseStates(IDS, { deps: { usedBy } });
    // web/src/lib/b.js is in the same building and does not count; city/1.js counts once
    expect(h["web/src/lib"].pillar).toBe(5);
    expect(h.specs).toBeUndefined(); // two users: below the minimum
  });
  it("marks folders a locked zone or the task scope covers", () => {
    const h = houseStates(IDS, { locked: ["install/**", "web/src/**"], allow: ["specs/**"] });
    expect(h.install.locked).toBe(true);
    expect(h["web/src/city"].locked).toBe(true);
    expect(h.web).toBeUndefined(); // only partly locked
    expect(h.specs.scope).toBe(true);
    expect(h["(root)"]).toBeUndefined();
    expect(houseStates(IDS, { locked: ["**"] })["(root)"].locked).toBe(true);
  });
});

describe("subagents", () => {
  const sub = (kind, ms, more = {}) => ({ session: "main", agent: "sub1", kind, ts: ago(ms), paths: [], ...more });
  const main = (kind, ms, more = {}) => ({ session: "main", agent: null, kind, ts: ago(ms), paths: [], ...more });
  it("takes its main agent's character", () => {
    const feed = [
      { session: "other", agent: null, kind: "read", ts: ago(500), paths: ["specs/a.md"] },
      sub("read", 1000, { paths: ["web/src/lib/a.js"] }),
      main("write", 2000, { paths: ["install/x.sh"] }),
    ];
    const agents = {
      main: { path: "install/x.sh", ts: ago(2000), kind: "write" },
      sub1: { path: "web/src/lib/a.js", ts: ago(1000), kind: "read" },
      other: { path: "specs/a.md", ts: ago(500), kind: "read" },
    };
    // the page numbers main agents only (lib/sessions.js): the subagent has its main agent's number
    const s = townState({ agents, files: {}, feed }, { main: 1, sub1: 1, other: 2 }, IDS, NOW);
    const by = Object.fromEntries(s.agents.map((a) => [a.key, a]));
    expect(by.main).toMatchObject({ character: "hero", parent: null });
    expect(by.sub1).toMatchObject({ character: "hero", parent: "main", building: "web/src/lib", action: "read" });
    expect(by.other.character).toBe("mage");
  });
  it("leaves soon after its last event", () => {
    const feed = [main("read", 1000, { paths: ["specs/a.md"] }), sub("read", SUB_GONE_MS + 1, { paths: ["specs/b.md"] })];
    const s = townState({ agents: {}, files: {}, feed }, { main: 1, sub1: 2 }, IDS, NOW);
    expect(s.agents.map((a) => a.key)).toEqual(["main"]);
  });
});

describe("out-of-scope writes", () => {
  const warnings = new Map([
    ["k1", { rule: "outOfScope", path: "specs/a.md", agent: "a", ts: ago(3000) }],
    ["k2", { rule: "newArea", path: "specs/b.md", agent: "a", ts: ago(1000) }],
    ["k3", { rule: "conflict", path: "install/x.sh", agent: "a", ts: ago(500) }],
  ]);
  it("tell each agent when it last wrote out of place", () => {
    const s = townState({ agents: { a: { path: "specs/b.md", ts: ago(1000), kind: "write" } }, files: {} }, { a: 1 }, IDS, NOW, {}, warnings);
    expect(s.agents[0].warnAt).toBe(NOW - 1000);
  });
  it("flag a building until its files are reviewed", () => {
    expect(houseStates(IDS, { warnings }).specs.warn).toBe(2);
    expect(houseStates(IDS, { warnings, reviewed: new Set(["specs/a.md"]) }).specs.warn).toBe(1);
    expect(houseStates(IDS, { warnings }).install).toBeUndefined();
  });
});

describe("prioritize", () => {
  it("shows the two most important states and folds the rest", () => {
    expect(prioritize(["scope", "warn", "scaffold", "failed"])).toEqual({ show: ["failed", "scaffold"], folded: ["warn", "scope"] });
    expect(prioritize(["scope"])).toEqual({ show: ["scope"], folded: [] });
  });
});

describe("buildingModes", () => {
  it("gives each building its main role, what was touched and the branch diff", () => {
    const paths = ["web/src/lib/a.js", "web/src/lib/a.test.js", "web/src/lib/b.test.js", "specs/09.md", "specs/x.json", "specs/y.md"];
    const files = { "specs/09.md": { reads: 2, writes: 0 }, "web/src/lib/a.js": { reads: 1, writes: 1 } };
    const diff = new Map([["specs/new.md", { status: "A" }], ["specs/09.md", { status: "M" }], ["install/old.sh", { status: "D" }]]);
    const m = buildingModes(IDS, paths, { files, diff });
    expect(m["web/src/lib"]).toMatchObject({ role: "test", touched: "written" });
    expect(m.specs).toMatchObject({ role: "doc", touched: "read", added: 1, modified: 1 });
    expect(m.install).toMatchObject({ role: null, touched: null, deleted: 1 });
  });
});
