import { describe, it, expect } from "vitest";
import { buildingTransform, cityBounds } from "./geometry.js";

const depths = { "": 0, api: 1, "api/Anvil": 2 };

describe("buildingTransform", () => {
  it("places a nested building on its district's stacked base", () => {
    const b = { path: "api/Anvil/Data/UnitOfWork.cs", x: 3, z: 4, lines: 110, height: 2.04 };
    // parent dir "api/Anvil/Data" is not a district; nearest known ancestor? No —
    // the map keys are exact district paths, so an unknown parent falls back to depth 0.
    expect(buildingTransform(b, depths)).toEqual({
      position: [3.5, 1.02, 4.5],
      scale: [0.9, 2.04, 0.9],
    });
  });

  it("uses the parent directory's depth when it is a district", () => {
    const b = { path: "api/Anvil/file.cs", x: 0, z: 0, lines: 10, height: 1 };
    // parent dir "api/Anvil" has depth 2 -> base 0.2
    expect(buildingTransform(b, depths)).toEqual({
      position: [0.5, 0.7, 0.5],
      scale: [0.9, 1, 0.9],
    });
  });

  it("treats root files as depth 0", () => {
    const b = { path: "README.md", x: 2, z: 7, lines: 5, height: 0.4 };
    expect(buildingTransform(b, depths)).toEqual({
      position: [2.5, 0.2, 7.5],
      scale: [0.9, 0.4, 0.9],
    });
  });

  it("defaults to depth 0 with no district map", () => {
    const b = { path: "a/b/c.cs", x: 1, z: 1, lines: 1, height: 2 };
    expect(buildingTransform(b)).toEqual({
      position: [1.5, 1, 1.5],
      scale: [0.9, 2, 0.9],
    });
  });
});

describe("cityBounds", () => {
  it("returns the origin-centered extent of the city", () => {
    expect(cityBounds({ width: 120.5, depth: 80 })).toEqual({
      center: [0, 0, 0],
      size: [120.5, 0, 80],
    });
  });

  it("tolerates missing dimensions", () => {
    expect(cityBounds({})).toEqual({ center: [0, 0, 0], size: [0, 0, 0] });
  });
});
