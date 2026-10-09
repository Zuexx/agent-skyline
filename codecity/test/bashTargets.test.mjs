import { test } from "node:test";
import assert from "node:assert/strict";
import { bashWriteTargets as t } from "../lib/bashTargets.mjs";

test("redirections, separate and attached", () => {
  assert.deepEqual(t("echo '// touched' > locked/secret.ts"), ["locked/secret.ts"]);
  assert.deepEqual(t('printf "x" >>notes.txt'), ["notes.txt"]);
  assert.deepEqual(t("make 2> build.log"), ["build.log"]);
  assert.deepEqual(t("ls > /dev/null"), []);
});

test("file-writing commands", () => {
  assert.deepEqual(t("tee -a a.txt b.txt"), ["a.txt", "b.txt"]);
  assert.deepEqual(t("sed -i 's/a/b/' src/x.ts src/y.ts"), ["src/x.ts", "src/y.ts"]);
  assert.deepEqual(t("sed -n '1,5p' src/x.ts"), []); // no -i: read only
  assert.deepEqual(t("cp -r src/a.ts locked/a.ts"), ["locked/a.ts"]);
  assert.deepEqual(t("mv old.ts new.ts"), ["old.ts", "new.ts"]);
  assert.deepEqual(t("rm -rf build dist"), ["build", "dist"]);
  assert.deepEqual(t("touch a && mkdir -p b/c"), ["a", "b/c"]);
});

test("git and PowerShell forms", () => {
  assert.deepEqual(t("git checkout -- locked/secret.ts"), ["locked/secret.ts"]);
  assert.deepEqual(t("git restore --staged src/a.ts"), ["src/a.ts"]);
  assert.deepEqual(t('Set-Content -Path locked\\x.ts -Value "y"'), ["locked/x.ts"]);
  assert.deepEqual(t("Remove-Item locked/x.ts -Force"), ["locked/x.ts"]);
  assert.deepEqual(t("Copy-Item a.ts -Destination locked/a.ts"), ["locked/a.ts"]);
});

test("cd shifts the folder for later segments; reads are not targets", () => {
  assert.deepEqual(t("cd api && echo x > Anvil/a.cs"), ["api/Anvil/a.cs"]);
  assert.deepEqual(t("cat locked/secret.ts | grep x"), []);
  assert.deepEqual(t("cd /d/Labs/forgekit && echo x > a.ts"), ["/d/Labs/forgekit/a.ts"]);
  assert.deepEqual(t(""), []);
  assert.deepEqual(t(null), []);
});
