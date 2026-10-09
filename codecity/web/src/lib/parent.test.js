import { describe, it, expect } from "vitest";
import { parentDir } from "./parent.js";

describe("parentDir", () => {
  it("returns the containing directory for nested paths", () => {
    expect(parentDir("a/b/c.ts")).toBe("a/b");
  });

  it('returns "" for root-level files', () => {
    expect(parentDir("c.ts")).toBe("");
  });

  it("handles deeper real-world paths", () => {
    expect(parentDir("api/Anvil/Data/UnitOfWork.cs")).toBe("api/Anvil/Data");
  });

  it("keeps empty directory segments intact", () => {
    expect(parentDir("a//b/c.ts")).toBe("a//b");
  });
});
