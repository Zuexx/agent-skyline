import { describe, it, expect } from "vitest";
import { districtGlob, toggleDistrictGlob, isLockedPath } from "./zones.js";

describe("zones", () => {
  it("stores a district lock as <path>/** and never locks the root", () => {
    expect(districtGlob("api/Anvil")).toBe("api/Anvil/**");
    expect(districtGlob("")).toBe(null);
  });

  it("toggles a district on and off without touching other globs", () => {
    const on = toggleDistrictGlob(["*.lock"], "api");
    expect(on).toEqual(["*.lock", "api/**"]);
    expect(toggleDistrictGlob(on, "api")).toEqual(["*.lock"]);
    expect(toggleDistrictGlob(["*.lock"], "")).toEqual(["*.lock"]);
  });

  it("matches paths the same way the guard hook does", () => {
    expect(isLockedPath("api/Anvil/Data/UnitOfWork.cs", ["api/Anvil/**"])).toBe(true);
    expect(isLockedPath("API/anvil/x.cs", ["api/Anvil/**"])).toBe(true);
    expect(isLockedPath("api/ForgeKit.Api/Program.cs", ["api/Anvil/**"])).toBe(false);
  });
});
