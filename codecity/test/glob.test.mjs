import { test } from "node:test";
import assert from "node:assert/strict";
import { matchGlob } from "../lib/glob.mjs";

function t(glob, path) {
  return assert.equal(matchGlob(glob, path), true, `${glob} should match ${path}`);
}

function f(glob, path) {
  return assert.equal(matchGlob(glob, path), false, `${glob} should not match ${path}`);
}

test("** matches any number of segments, including zero", () => {
  t("a/**", "a");
  t("a/**", "a/b");
  t("a/**", "a/b/c");
  f("a/**", "b");
  f("a/**", "ab");

  t("**/x.ts", "x.ts");
  t("**/x.ts", "a/b/x.ts");
  f("**/x.ts", "ax.ts");
  f("**/x.ts", "x.txt");

  // bare ** matches everything
  t("**", "");
  t("**", "anything/at/all");
});

test("* matches any characters except /", () => {
  t("*.ts", "a.ts");
  t("*.ts", "abcd.ts");
  f("*.ts", "a/b.ts"); // must not cross a segment boundary
  t("a/*/c", "a/b/c");
  f("a/*/c", "a/b/d/c");
});

test("? matches exactly one character except /", () => {
  t("a?c", "abc");
  f("a?c", "abbc");
  f("a?c", "ac");
  f("a?c", "a/c");
});

test("literal characters stay literal, including regex metacharacters", () => {
  t("file.txt", "file.txt");
  f("file.txt", "fileXtxt"); // "." must not act as a wildcard
  t("a+b.ts", "a+b.ts");
  f("a+b.ts", "aab.ts");
  t("(x)", "(x)");
  f("(x)", "y");
});

test("matching is case-insensitive", () => {
  t("*.TS", "b.ts");
  t("**/*.ts", "A/B/X.TS");
  t("API/ANVIL/**", "api/anvil/core/x.cs");
  f("README.MD", "readme.txt");
});

test("non-string input is not a match", () => {
  assert.equal(matchGlob(null, "a"), false);
  assert.equal(matchGlob("*", null), false);
  assert.equal(matchGlob(42, "a"), false);
});
