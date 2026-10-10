import { describe, it, expect } from "vitest";
import { pathIndex, pathsInCommand } from "./commandPaths.js";

const idx = pathIndex([
  "api/Anvil/Data/UnitOfWork.cs",
  "api/ForgeKit.Api/Program.cs",
  "app/package.json",
  "package.json",
  "docs/api/API_ERRORS.md",
  "README.md",
]);

describe("pathsInCommand", () => {
  it("finds exact repo-relative paths", () => {
    expect(pathsInCommand("sed -n 1,40p api/Anvil/Data/UnitOfWork.cs", idx)).toEqual(["api/Anvil/Data/UnitOfWork.cs"]);
    expect(pathsInCommand("cat ./README.md | head", idx)).toEqual(["README.md"]);
  });

  it("resolves paths relative to a subfolder when the suffix is unique", () => {
    expect(pathsInCommand("cd api && cat ForgeKit.Api/Program.cs", idx)).toEqual(["api/ForgeKit.Api/Program.cs"]);
  });

  it("matches a bare file name only when it is unique", () => {
    expect(pathsInCommand("grep -n Commit UnitOfWork.cs", idx)).toEqual(["api/Anvil/Data/UnitOfWork.cs"]);
    expect(pathsInCommand("cat package.json", idx)).toEqual(["package.json"]); // exact wins
    expect(pathsInCommand("cd app && cat x/package.json", idx)).toEqual([]); // no such suffix
  });

  it("handles quotes, several files, and ignores words and absolute paths", () => {
    expect(
      pathsInCommand('grep -n "message" docs/api/API_ERRORS.md; wc -l "api/ForgeKit.Api/Program.cs"', idx)
    ).toEqual(["docs/api/API_ERRORS.md", "api/ForgeKit.Api/Program.cs"]);
    expect(pathsInCommand("git status && dotnet test", idx)).toEqual([]);
    expect(pathsInCommand("cat /d/Labs/forgekit/README.md", idx)).toEqual([]);
    expect(pathsInCommand(null, idx)).toEqual([]);
  });
});
