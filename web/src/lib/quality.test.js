import { describe, expect, it } from "vitest";
import { createQualityGovernor } from "./quality.js";

const run = (g, ms, totalMs) => {
  let changed = 0;
  for (let t = 0; t < totalMs; t += ms) if (g.frame(ms)) changed++;
  return changed;
};

describe("createQualityGovernor", () => {
  it("keeps the level while frames are fast", () => {
    const g = createQualityGovernor("high");
    expect(run(g, 16, 10000)).toBe(0);
    expect(g.level).toBe("high");
  });

  it("steps down one level after three slow seconds, and again if it stays slow", () => {
    const g = createQualityGovernor("high");
    run(g, 33, 3600);
    expect(g.level).toBe("medium");
    run(g, 33, 3600);
    expect(g.level).toBe("low");
    run(g, 33, 3600);
    expect(g.level).toBe("low");
  });

  it("does not step down for a short hitch, and never steps back up", () => {
    const g = createQualityGovernor("medium");
    run(g, 50, 1000);
    run(g, 16, 2000);
    run(g, 50, 1000);
    expect(g.level).toBe("medium");
    run(g, 33, 4000);
    run(g, 8, 20000);
    expect(g.level).toBe("low");
  });

  it("starts at high for an unknown level", () => {
    expect(createQualityGovernor("ultra").level).toBe("high");
  });
});
