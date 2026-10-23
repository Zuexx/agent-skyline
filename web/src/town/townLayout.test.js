import { describe, expect, it } from "vitest";
import { buildingOf, groupFiles, layoutToPixel, roleOf, townBuildings } from "./townLayout.js";

const many = (dir, n, ext = "js") => Array.from({ length: n }, (_, i) => `${dir}/f${i}.${ext}`);

describe("groupFiles", () => {
  it("keeps a small top-level folder whole and root files in (root)", () => {
    const g = groupFiles(["README.md", ...many("cli", 5), ...many("cli/sub", 2)]);
    expect([...g.keys()].sort()).toEqual(["(root)", "cli"]);
    expect(g.get("cli")).toHaveLength(7);
  });

  it("splits a big folder into its subfolders and merges small ones back", () => {
    const g = groupFiles([...many("proto/a/godot", 16), ...many("proto/a/tauri", 11), ...many("proto/a/web", 2), ...many("proto/a", 6)]);
    expect([...g.keys()].sort()).toEqual(["proto/a", "proto/a/godot", "proto/a/tauri"]);
    expect(g.get("proto/a")).toHaveLength(8); // its own 6 plus web's 2
  });

  it("cascades a merge into a parent that had no files of its own", () => {
    const g = groupFiles([...many("big/x", 40), ...many("big/y/z", 2)]);
    expect([...g.keys()].sort()).toEqual(["big", "big/x"]);
  });
});

describe("roleOf", () => {
  it("reads tests, docs, config, assets and code", () => {
    expect(roleOf("web/src/a.test.js")).toBe("test");
    expect(roleOf("specs/01.md")).toBe("docs");
    expect(roleOf("desktop/Cargo.toml")).toBe("config");
    expect(roleOf("icons/a.png")).toBe("asset");
    expect(roleOf("lib/a.mjs")).toBe("code");
  });
});

describe("townBuildings", () => {
  const painted = [
    { id: "(root)", layout: [0, -9] },
    { id: "lib", layout: [16, -8] },
    { id: "web/public", layout: [-40, 8] },
  ];
  const lots = [
    [26, 20],
    [-48, -32],
  ];

  it("keeps painted folders, even ones the rule would merge, and makes sites for the rest", () => {
    const paths = ["README.md", ...many("lib", 12), ...many("web/src", 40), "web/public/x.svg", ...many("desktop", 8, "rs")];
    const town = townBuildings(paths, painted, lots);
    const byId = Object.fromEntries(town.map((b) => [b.id, b]));
    expect(byId["web/public"]).toMatchObject({ painted: true, files: 1 });
    expect(byId.lib).toMatchObject({ painted: true, files: 12 });
    expect(byId.desktop.painted).toBe(false);
    expect(byId.desktop.lot).toBeTruthy();
    expect(byId["web/src"].painted).toBe(false);
  });

  it("gives each site a different lot, and none when the lots run out", () => {
    const paths = [...many("a", 9), ...many("b", 8), ...many("c", 7)];
    const sites = townBuildings(paths, painted, lots).filter((b) => !b.painted && b.files);
    const lotsTaken = sites.map((b) => b.lot).filter(Boolean);
    expect(lotsTaken).toHaveLength(2);
    expect(new Set(lotsTaken.map(String)).size).toBe(2);
    expect(sites.filter((b) => b.lot === null)).toHaveLength(1);
  });

  it("drops painted folders that no longer exist, but always keeps the root", () => {
    const town = townBuildings(["README.md"], painted, lots);
    expect(town.map((b) => b.id).sort()).toEqual(["(root)"]);
  });
});

describe("buildingOf / layoutToPixel", () => {
  it("finds the deepest building holding a path", () => {
    expect(buildingOf("web/src/ui/a.js", ["(root)", "web", "web/src"])).toBe("web/src");
    expect(buildingOf("x.js", ["(root)", "web"])).toBe("(root)");
  });

  it("applies a homography", () => {
    const h = [
      [2, 0, 10],
      [0, 3, 20],
      [0, 0, 1],
    ];
    expect(layoutToPixel(h, [1, 2])).toEqual([12, 26]);
  });
});
