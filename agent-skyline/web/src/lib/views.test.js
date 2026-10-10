import { describe, it, expect } from "vitest";
import { roleOf, touchedOf, diffOf, buildView } from "./views.js";

describe("roleOf", () => {
  it.each([
    ["api/Anvil/Data/UnitOfWork.cs", "code"],
    ["app/components/user-menu.tsx", "code"],
    ["api/Anvil.Tests/Data/PlatformDbContextTests.cs", "test"],
    ["app/proxies/create-proxy.test.ts", "test"],
    ["app/e2e/auth.spec.ts", "test"],
    ["openspec/specs/foundations/spec.md", "spec"],
    ["docs/adr/001-module-feature-pattern.md", "doc"],
    ["README.md", "doc"],
    ["app/package.json", "config"],
    [".github/workflows/ci.yml", "config"],
    [".gitignore", "config"],
    ["api/ForgeKit.sln", "config"],
    ["app/public/en.mp4", "asset"],
  ])("%s → %s", (path, role) => {
    expect(roleOf(path)).toBe(role);
  });
});

describe("touchedOf", () => {
  it("groups by writes, then reads", () => {
    const files = { a: { writes: 1, reads: 3 }, b: { reads: 2, writes: 0 }, c: { blocked: 1, writes: 0 } };
    expect(touchedOf("a", files)).toBe("written");
    expect(touchedOf("b", files)).toBe("read");
    expect(touchedOf("c", files)).toBe("written");
    expect(touchedOf("d", files)).toBe("untouched");
  });
});

describe("diffOf", () => {
  it("maps git statuses to groups", () => {
    const diff = new Map([["a", { status: "A" }], ["m", { status: "M" }], ["r", { status: "R" }], ["d", { status: "D" }]]);
    expect(["a", "m", "r", "d", "x"].map((p) => diffOf(p, diff))).toEqual(["added", "modified", "modified", "deleted", "unchanged"]);
  });
});

describe("buildView", () => {
  const city = {
    width: 10,
    depth: 10,
    districts: [{ path: "", depth: 0, x: 0, z: 0, w: 10, d: 10 }],
    buildings: [
      { path: "src/a.ts", x: 1, z: 1, lines: 10, height: 1 },
      { path: "src/a.test.ts", x: 3, z: 1, lines: 5, height: 0.8 },
      { path: "README.md", x: 5, z: 1, lines: 3, height: 0.6 },
    ],
  };

  it("keeps the folder view as the server laid it out", () => {
    const v = buildView(city, "folder");
    expect(v.buildings.map((b) => [b.path, b.x, b.z, b.dir])).toEqual([
      ["src/a.ts", 1, 1, "src"],
      ["src/a.test.ts", 3, 1, "src"],
      ["README.md", 5, 1, ""],
    ]);
  });

  it("re-lays files under group districts but keeps building order and real paths", () => {
    const v = buildView(city, "role");
    expect(v.buildings.map((b) => b.path)).toEqual(city.buildings.map((b) => b.path));
    expect(v.buildings.map((b) => b.dir)).toEqual(["code/src", "test/src", "doc"]);
    expect(v.districts.map((d) => d.path)).toEqual(expect.arrayContaining(["code", "test", "doc"]));
  });
});
