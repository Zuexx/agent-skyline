import { describe, expect, it } from "vitest";
import { packRects } from "./spriteAtlas.js";

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("packRects", () => {
  it("packs into the smallest power-of-two square without overlaps", () => {
    const sizes = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, w: 100 + (i % 5) * 10, h: 90 + (i % 7) * 20 }));
    const { size, rects } = packRects(sizes);
    expect(size).toBe(1024);
    expect(rects).toHaveLength(30);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      expect(r.x + r.w).toBeLessThanOrEqual(size);
      expect(r.y + r.h).toBeLessThanOrEqual(size);
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(r, rects[j])).toBe(false);
    }
  });

  it("gives up past the maximum size", () => {
    expect(packRects([{ name: "huge", w: 3000, h: 10 }])).toBeNull();
    expect(packRects(Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, w: 200, h: 200 })))).toBeNull();
  });
});
