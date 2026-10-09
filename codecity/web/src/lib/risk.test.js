import { describe, expect, it } from "vitest";
import { rankReview, reviewItems } from "./risk.js";
import { indexDeps } from "./deps.js";

const deps = indexDeps([
  ["src/a.ts", "src/core.ts"],
  ["src/b.ts", "src/core.ts"],
  ["src/c.ts", "src/core.ts"],
  ["src/core.test.ts", "src/core.ts"],
  ["src/a.ts", "src/old.ts"],
]);

describe("rankReview", () => {
  it("puts warned, untested, hot code first and explains why", () => {
    const ranked = rankReview(
      [
        { path: "README.md", added: 400, removed: 0 },
        { path: "src/core.ts", added: 10, removed: 2 },
        { path: "src/a.ts", added: 5, removed: 1 },
      ],
      { deps, churn: { "src/a.ts": 7 }, warned: new Set(["src/a.ts"]) }
    );
    expect(ranked.map((r) => r.path)).toEqual(["src/a.ts", "src/core.ts", "README.md"]);
    expect(ranked[0].reasons.map((r) => r.key)).toEqual(["warning", "untested", "churn"]);
    // core.ts has a test, but three files use it.
    expect(ranked[1].reasons).toEqual([{ key: "usedBy", n: 3 }]);
    // A big docs change is still worth a look, at a discount.
    expect(ranked[2].reasons).toEqual([{ key: "big", n: 400 }]);
  });

  it("flags a deleted file that other files still use", () => {
    const [r] = rankReview([{ path: "src/old.ts", status: "D", added: 0, removed: 20 }], { deps });
    expect(r.reasons).toEqual([{ key: "deletedUsed", n: 1 }]);
  });

  it("does not call code untested when dependencies are unknown", () => {
    const [r] = rankReview([{ path: "src/x.ts", writes: 1 }], {});
    expect(r.reasons).toEqual([]);
  });

  it("flags imports a changed file never uses", () => {
    const withUnused = indexDeps([["src/a.ts", "src/old.ts", "unused"]]);
    const [r] = rankReview([{ path: "src/a.ts", status: "M", added: 1, removed: 0 }], { deps: withUnused });
    expect(r.reasons.map((x) => [x.key, x.n])).toContainEqual(["unusedImport", 1]);
  });

  it("counts repeated writes in a live session", () => {
    const [r] = rankReview([{ path: "src/core.ts", writes: 4 }], { deps });
    expect(r.reasons.map((x) => x.key)).toContain("rewrites");
  });
});

describe("reviewItems", () => {
  it("takes the diff while comparing", () => {
    const diff = new Map([["a.ts", { path: "a.ts", status: "M", added: 1, removed: 2 }]]);
    expect(reviewItems({ diff, files: { "b.ts": { writes: 1 } } })).toEqual([{ path: "a.ts", status: "M", added: 1, removed: 2 }]);
  });

  it("merges uncommitted changes with this session's writes", () => {
    const working = new Map([
      ["a.ts", { path: "a.ts", status: "M", added: 3, removed: 1 }],
      ["mine.md", { path: "mine.md", status: "A", added: 5, removed: 0 }],
    ]);
    const files = { "a.ts": { writes: 2 }, "done.ts": { writes: 1 } };
    expect(reviewItems({ files, working })).toEqual([
      { path: "a.ts", status: "M", added: 3, removed: 1, writes: 2 },
      { path: "mine.md", status: "A", added: 5, removed: 0 },
      { path: "done.ts", writes: 1 },
    ]);
  });

  it("takes written or blocked files otherwise", () => {
    const files = { "a.ts": { reads: 3, writes: 0, blocked: 0 }, "b.ts": { writes: 2 }, "c.ts": { writes: 0, blocked: 1 } };
    expect(reviewItems({ files }).map((i) => i.path)).toEqual(["b.ts", "c.ts"]);
  });
});
