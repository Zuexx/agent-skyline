import { describe, expect, it } from "vitest";
import { packName, resolvePalette, validatePack } from "./themePack.js";
import { builtinPack } from "../theme.js";

const minimal = (extra = {}) => ({ id: "quest", renderer: "sprites", variants: { day: { palette: { background: "#bfe3ff" } } }, ...extra });

describe("validatePack", () => {
  it("fills what a pack leaves out from the built-in pack, variant by variant", () => {
    const { ok, pack } = validatePack(minimal(), "quest", builtinPack);
    expect(ok).toBe(true);
    expect(pack.variants.day.palette.background).toBe("#bfe3ff");
    expect(pack.variants.day.palette.read).toBe(builtinPack.variants.day.palette.read);
  });

  it("rejects a pack whose id, renderer or variants are wrong", () => {
    expect(validatePack(minimal({ id: "other" }), "quest", builtinPack).errors[0]).toMatch(/folder name/);
    expect(validatePack(minimal({ renderer: "voxels" }), "quest", builtinPack).ok).toBe(false);
    expect(validatePack(minimal({ variants: {} }), "quest", builtinPack).ok).toBe(false);
    expect(validatePack(minimal({ variants: { day: {} } }), "quest", builtinPack).errors).toEqual(['variant "day" has no palette']);
    expect(validatePack(null, "quest", builtinPack).ok).toBe(false);
  });

  it("accepts the built-in pack as it ships", () => {
    expect(validatePack(builtinPack, "blocks", builtinPack).ok).toBe(true);
  });
});

describe("resolvePalette and packName", () => {
  it("picks the wanted variant, or the pack's only one", () => {
    expect(resolvePalette(builtinPack, "day").variant).toBe("day");
    const { pack } = validatePack(minimal(), "quest", builtinPack);
    expect(resolvePalette(pack, "night")).toMatchObject({ variant: "day" });
  });

  it("names a pack in the locale, then English, then by id", () => {
    expect(packName(builtinPack, "zh-TW")).toBe("方塊城市");
    expect(packName({ id: "x", name: { en: "X" } }, "zh-TW")).toBe("X");
    expect(packName({ id: "x" }, "en")).toBe("x");
  });
});
