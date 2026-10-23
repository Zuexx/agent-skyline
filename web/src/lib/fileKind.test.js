import { describe, expect, it } from "vitest";
import { buildingKind, sizeTier, tierCuts } from "./fileKind.js";

describe("buildingKind", () => {
  it("maps roles to the five building kinds", () => {
    expect(buildingKind("src/app.ts")).toBe("code");
    expect(buildingKind("src/app.test.ts")).toBe("test");
    expect(buildingKind("docs/guide.md")).toBe("docs");
    expect(buildingKind("package.json")).toBe("config");
    expect(buildingKind("assets/logo.png")).toBe("other");
  });
});

describe("tiers", () => {
  it("cuts at the repo's own thirds", () => {
    const cuts = tierCuts([1, 2, 3, 10, 20, 30, 100, 200, 300]);
    expect(cuts).toEqual([10, 100]);
    expect([1, 10, 11, 100, 101].map((n) => sizeTier(n, cuts))).toEqual([0, 0, 1, 1, 2]);
  });

  it("copes with empty and uniform repos", () => {
    expect(tierCuts([])).toEqual([0, 0]);
    expect(sizeTier(5, tierCuts([5, 5, 5]))).toBe(0);
  });
});
