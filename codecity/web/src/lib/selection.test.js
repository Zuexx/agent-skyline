import { describe, expect, it } from "vitest";
import { pathsInRect, rectFrom, taskPrompt, toggleAll } from "./selection.js";

describe("box selection", () => {
  const points = { "a.ts": { x: 10, y: 10 }, "b.ts": { x: 50, y: 50 }, "c.ts": { x: 90, y: 20 }, "off.ts": null };
  const screenOf = (p) => points[p];

  it("normalizes a rectangle dragged in any direction", () => {
    expect(rectFrom({ x: 60, y: 60 }, { x: 0, y: 0 })).toEqual({ left: 0, top: 0, right: 60, bottom: 60 });
  });

  it("picks the buildings inside the rectangle, skipping ones off screen", () => {
    expect(pathsInRect(Object.keys(points), screenOf, rectFrom({ x: 0, y: 0 }, { x: 60, y: 60 }))).toEqual(["a.ts", "b.ts"]);
  });

  it("adds a box to the selection, and removes it when all of it was selected", () => {
    const once = toggleAll(new Set(["c.ts"]), ["a.ts", "b.ts"]);
    expect([...once].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect([...toggleAll(once, ["a.ts", "b.ts"])]).toEqual(["c.ts"]);
  });
});

describe("taskPrompt", () => {
  it("puts the task first and the sorted files as its scope", () => {
    expect(taskPrompt("Add tests", ["src/b.ts", "src/a.ts"], "en")).toBe(
      "Add tests\n\nScope: change only these files (reading others is fine; if a file outside this list really needs changing, stop and ask me first):\n- src/a.ts\n- src/b.ts\n"
    );
  });

  it("leaves a placeholder when no task was written, in the UI language", () => {
    expect(taskPrompt("  ", ["a.ts"], "zh-TW")).toMatch(/^\(在這裡寫任務\)\n\n範圍:/);
  });
});
