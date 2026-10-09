import { describe, expect, it } from "vitest";
import { depsOf, indexDeps, unpackDeps } from "./deps.js";

describe("unpackDeps", () => {
  it("turns the server's index pairs back into path pairs", () => {
    expect(unpackDeps({ paths: ["a.ts", "b.ts", "c.ts"], edges: [0, 1, 2, 1] })).toEqual([
      ["a.ts", "b.ts"],
      ["c.ts", "b.ts"],
    ]);
  });

  it("passes an older server's path pairs through", () => {
    expect(unpackDeps({ edges: [["a.ts", "b.ts"]] })).toEqual([["a.ts", "b.ts"]]);
  });
});

describe("deps index", () => {
  const index = indexDeps([
    ["src/page.tsx", "src/lib/util.ts"],
    ["src/api.ts", "src/lib/util.ts"],
    ["src/lib/util.test.ts", "src/lib/util.ts"],
    ["src/page.tsx", "src/api.ts"],
  ]);

  it("lists what a file uses", () => {
    expect(depsOf(index, "src/page.tsx").uses).toEqual(["src/api.ts", "src/lib/util.ts"]);
  });

  it("separates tests from other users", () => {
    const d = depsOf(index, "src/lib/util.ts");
    expect(d.usedBy).toEqual(["src/api.ts", "src/page.tsx"]);
    expect(d.testedBy).toEqual(["src/lib/util.test.ts"]);
  });

  it("is empty for unknown files and a missing index", () => {
    expect(depsOf(index, "nope.ts")).toEqual({ uses: [], usedBy: [], testedBy: [] });
    expect(depsOf(null, "x")).toEqual({ uses: [], usedBy: [], testedBy: [] });
  });
});
