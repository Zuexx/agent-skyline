import { describe, it, expect, afterEach } from "vitest";
import { t, setLocale, localeKeys } from "./i18n.js";

afterEach(() => setLocale("zh-TW"));

describe("i18n", () => {
  it("has the same keys in every locale", () => {
    expect(localeKeys("en").sort()).toEqual(localeKeys("zh-TW").sort());
  });

  it("interpolates and switches locale", () => {
    expect(t("top.counts", { files: 3, dirs: 2 })).toBe("3 個檔案 · 2 個資料夾");
    setLocale("en");
    expect(t("top.counts", { files: 3, dirs: 2 })).toBe("3 files · 2 folders");
  });

  it("falls back to the key for unknown strings and to zh-TW for unknown locales", () => {
    expect(t("no.such.key")).toBe("no.such.key");
    setLocale("xx");
    expect(t("kind.read")).toBe("讀取");
  });
});
