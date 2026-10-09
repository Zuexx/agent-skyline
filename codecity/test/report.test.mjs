import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT = fileURLToPath(new URL("../cli/report.mjs", import.meta.url));

function runReport(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REPORT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const LINES = [
  JSON.stringify({ ts: "2026-10-09T08:00:00.000Z", session: "alpha", agent: null, event: "PostToolUse", tool: "Write", kind: "write", paths: ["api/a.ts"], detail: null }),
  JSON.stringify({ ts: "2026-10-09T08:01:00.000Z", session: "alpha", agent: null, event: "PostToolUse", tool: "Edit", kind: "write", paths: ["api/a.ts"], detail: null }),
  JSON.stringify({ ts: "2026-10-09T08:02:00.000Z", session: "alpha", agent: null, event: "PostToolUse", tool: "Read", kind: "read", paths: ["README.md"], detail: null }),
  "{ this line is broken",
  JSON.stringify({ ts: "2026-10-09T08:03:00.000Z", session: "beta", agent: null, event: "PostToolUse", tool: "Bash", kind: "exec", paths: [], detail: "ls" }),
  JSON.stringify({ ts: "2026-10-09T08:04:00.000Z", session: "beta", agent: null, event: "PostToolUse", tool: "Write", kind: "write", paths: ["app/b.ts"], detail: null }),
].join("\n") + "\n";

async function withLog(fileContent, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-report-"));
  try {
    const file = path.join(dir, "events.jsonl");
    if (fileContent !== null) await writeFile(file, fileContent, "utf8");
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("report lists sessions oldest first with per-file counts and skips broken lines", async () => {
  await withLog(LINES, async (file) => {
    const { code, stdout } = await runReport(["--file", file]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("alpha"), `output should contain session alpha:\n${stdout}`);
    assert.ok(stdout.includes("beta"), `output should contain session beta:\n${stdout}`);
    assert.ok(
      stdout.indexOf("alpha") < stdout.indexOf("beta"),
      `sessions should be oldest first:\n${stdout}`
    );
    assert.ok(stdout.includes("api/a.ts (2)"), `expected count for api/a.ts:\n${stdout}`);
    assert.ok(stdout.includes("README.md (1)"), `expected count for README.md:\n${stdout}`);
    assert.ok(stdout.includes("app/b.ts (1)"), `expected count for app/b.ts:\n${stdout}`);
  });
});

test("--session filters to one session", async () => {
  await withLog(LINES, async (file) => {
    const { code, stdout } = await runReport(["--file", file, "--session", "beta"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("beta"), `output should contain session beta:\n${stdout}`);
    assert.ok(!stdout.includes("alpha"), `output should not contain session alpha:\n${stdout}`);
    assert.ok(stdout.includes("app/b.ts (1)"), `expected count for app/b.ts:\n${stdout}`);
  });
});

test("missing file prints 'no events' and exits 0", async () => {
  const missing = path.join(os.tmpdir(), "codecity-does-not-exist.jsonl");
  const { code, stdout } = await runReport(["--file", missing]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("no events"), `expected 'no events':\n${stdout}`);
});
