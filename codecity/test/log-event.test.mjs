import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/log-event.mjs", import.meta.url));

function runHook(stdinText, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (stdinText !== null && stdinText !== undefined) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

test("hook appends one JSON line for a valid payload; exit 0 and empty stdout", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-hook-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, "events.jsonl");

  const payloadText = JSON.stringify({
    session_id: "abc123",
    cwd: "D:\\Labs\\forgekit",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "D:\\Labs\\forgekit\\api\\Anvil\\Data\\UnitOfWork.cs" },
  });

  const { code, stdout } = await runHook(payloadText, { CODECITY_EVENTS: logFile });
  assert.equal(code, 0);
  assert.equal(stdout, "");

  const lines = (await readFile(logFile, "utf8")).split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev.session, "abc123");
  assert.equal(ev.tool, "Edit");
  assert.equal(ev.kind, "write");
  assert.deepEqual(ev.paths, ["api/Anvil/Data/UnitOfWork.cs"]);
});

test("hook exits 0 with empty stdout and leaves no log for invalid JSON", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-hook-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, "nested", "events.jsonl");

  const { code, stdout } = await runHook("{not json", { CODECITY_EVENTS: logFile });
  assert.equal(code, 0);
  assert.equal(stdout, "");

  let exists = true;
  try {
    await access(logFile);
  } catch {
    exists = false;
  }
  if (exists) assert.equal(await readFile(logFile, "utf8"), "");
});

test("hook creates the parent directory of the log file", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-hook-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, "deep", "nested", "events.jsonl");

  const payloadText = JSON.stringify({
    session_id: "s1",
    cwd: "/home/u/proj",
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/home/u/proj/a.ts" },
  });

  const { code, stdout } = await runHook(payloadText, { CODECITY_EVENTS: logFile });
  assert.equal(code, 0);
  assert.equal(stdout, "");
  const ev = JSON.parse((await readFile(logFile, "utf8")).trim());
  assert.deepEqual(ev.paths, ["a.ts"]);
});
