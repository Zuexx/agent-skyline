import { describe, expect, it } from "vitest";
import { vscodeUrl } from "./editor.js";

describe("vscodeUrl", () => {
  it("joins a Windows repo path and a repo file", () => {
    expect(vscodeUrl("D:/Labs/forgekit", "api/Anvil/Program.cs")).toBe("vscode://file/D:/Labs/forgekit/api/Anvil/Program.cs:1");
  });

  it("keeps a POSIX root to a single slash after file/", () => {
    expect(vscodeUrl("/home/me/repo/", "src/a.ts", 12)).toBe("vscode://file/home/me/repo/src/a.ts:12");
  });

  it("escapes characters that would break the URL", () => {
    expect(vscodeUrl("D:/my repo", "app/[id]/page#1?.tsx")).toBe("vscode://file/D:/my%20repo/app/%5Bid%5D/page%231%3F.tsx:1");
  });

  it("returns null without a repo path", () => {
    expect(vscodeUrl(undefined, "a.ts")).toBeNull();
  });
});
