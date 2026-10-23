import { describe, expect, it } from "vitest";
import { findPath, invert3, makeGrid, pathLength } from "./townPaths.js";

// Is [x, z] inside a house footprint (same shape makeGrid blocks)?
const inHouse = (houses, [x, z]) => houses.some(([hx, hz]) => Math.abs(x - hx) < 3.4 && z > hz - 6.4 && z < hz - 0.4);

describe("findPath", () => {
  const houses = [
    [-16, 8],
    [16, 8],
    [-16, -8],
    [16, -8],
    [0, -9],
  ];
  const g = makeGrid(houses);

  it("starts and ends at the given points", () => {
    const p = findPath(g, [-16, 10], [16, 10]);
    expect(p[0]).toEqual([-16, 10]);
    expect(p[p.length - 1]).toEqual([16, 10]);
  });

  it("goes around a house standing between the two points, never through it", () => {
    // from in front of a south-row house to in front of a north-row house behind it
    const p = findPath(g, [-16, 10], [-16, -6]);
    for (let i = 1; i < p.length; i++) {
      for (let t = 0; t <= 1; t += 0.1) {
        const q = [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
        expect(inHouse(houses, q)).toBe(false);
      }
    }
    expect(pathLength(p)).toBeGreaterThan(16); // a detour, not the straight 16 m
  });

  it("prefers the street over open grass", () => {
    // both ends near the east-west street: the route should stay close to z = 0
    const p = findPath(makeGrid([]), [-30, 4], [30, 4]);
    const mid = p.filter(([x]) => Math.abs(x) < 20);
    expect(mid.every(([, z]) => Math.abs(z) <= 2)).toBe(true);
  });
});

describe("invert3", () => {
  it("inverts a homography", () => {
    const m = [
      [2, 0.1, 10],
      [0.2, 3, 20],
      [0.001, 0.002, 1],
    ];
    const inv = invert3(m);
    const mul = m.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * inv[k][j], 0)));
    mul.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 9)));
  });
});
