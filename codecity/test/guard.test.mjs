import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/guard.mjs", import.meta.url));
const ROOT = "D:\\Labs\\forgekit";

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

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zonesFile = path.join(dir, "zones.json");
  await writeFile(zonesFile, JSON.stringify({ locked: ["api/Anvil/**", "*.lock"] }), "utf8");
  return {
    zonesFile,
    logFile: path.join(dir, "events.jsonl"),
  };
}

function payloadText(toolName, filePath) {
  return JSON.stringify({
    session_id: "abc123",
    cwd: ROOT,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  });
}

async function logExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test("Edit inside a locked zone → exit 0, deny object on stdout, one blocked line in the log", async (t) => {
  const { zonesFile, logFile } = await setup(t);
  const env = { CODECITY_ZONES: zonesFile, CODECITY_EVENTS: logFile, CLAUDE_PROJECT_DIR: ROOT };

  const { code, stdout } = await runHook(
    payloadText("Edit", "D:\\Labs\\forgekit\\api\\Anvil\\Data\\UnitOfWork.cs"),
    env
  );
  assert.equal(code, 0);

  const out = JSON.parse(stdout);
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: 'codecity: api/Anvil/Data/UnitOfWork.cs is in locked zone "api/Anvil/**"',
    },
  });

  assert.equal(await logExists(logFile), true);
  const lines = (await readFile(logFile, "utf8")).split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev.kind, "blocked");
  assert.equal(ev.tool, "Edit");
  assert.deepEqual(ev.paths, ["api/Anvil/Data/UnitOfWork.cs"]);
  assert.equal(ev.detail, 'codecity: api/Anvil/Data/UnitOfWork.cs is in locked zone "api/Anvil/**"');
});

test("Edit outside any zone → exit 0, empty stdout, no log", async (t) => {
  const { zonesFile, logFile } = await setup(t);
  const env = { CODECITY_ZONES: zonesFile, CODECITY_EVENTS: logFile, CLAUDE_PROJECT_DIR: ROOT };

  const { code, stdout } = await runHook(payloadText("Edit", "D:\\Labs\\forgekit\\app\\main.ts"), env);
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.equal(await logExists(logFile), false);
});

test("Read inside a zone → exit 0, empty stdout, no log", async (t) => {
  const { zonesFile, logFile } = await setup(t);
  const env = { CODECITY_ZONES: zonesFile, CODECITY_EVENTS: logFile, CLAUDE_PROJECT_DIR: ROOT };

  const { code, stdout } = await runHook(
    payloadText("Read", "D:\\Labs\\forgekit\\api\\Anvil\\Data\\UnitOfWork.cs"),
    env
  );
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.equal(await logExists(logFile), false);
});

test("Invalid stdin → exit 0, empty stdout", async (t) => {
  const { zonesFile, logFile } = await setup(t);
  const env = { CODECITY_ZONES: zonesFile, CODECITY_EVENTS: logFile, CLAUDE_PROJECT_DIR: ROOT };

  const { code, stdout } = await runHook("{not json", env);
  assert.equal(code, 0);
  assert.equal(stdout, "");
});
