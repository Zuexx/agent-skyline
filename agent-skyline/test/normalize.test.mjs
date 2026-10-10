import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lib/normalize.mjs";

const NOW = new Date("2026-10-09T08:00:00.000Z");
const CWD_WIN = "D:\\Labs\\forgekit";

function payload(overrides) {
  return { session_id: "abc123", cwd: CWD_WIN, hook_event_name: "PostToolUse", ...overrides };
}

test("Stop → stop kind (the agent is waiting); SubagentStop stays other", () => {
  assert.equal(normalize({ hook_event_name: "Stop", session_id: "s" }).kind, "stop");
  assert.equal(normalize({ hook_event_name: "SubagentStop", session_id: "s" }).kind, "other");
});

test("Read → read kind with file_path", () => {
  const ev = normalize(payload({ tool_name: "Read", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }), NOW);
  assert.equal(ev.kind, "read");
  assert.deepEqual(ev.paths, ["api/x.cs"]);
  assert.equal(ev.detail, null);
});

test("Edit → write kind with file_path", () => {
  const ev = normalize(payload({ tool_name: "Edit", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }), NOW);
  assert.equal(ev.kind, "write");
  assert.deepEqual(ev.paths, ["api/x.cs"]);
  assert.equal(ev.detail, null);
});

test("Write → write kind with file_path", () => {
  const ev = normalize(payload({ tool_name: "Write", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }), NOW);
  assert.equal(ev.kind, "write");
  assert.deepEqual(ev.paths, ["api/x.cs"]);
  assert.equal(ev.detail, null);
});

test("MultiEdit → write kind with file_path", () => {
  const ev = normalize(payload({ tool_name: "MultiEdit", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }), NOW);
  assert.equal(ev.kind, "write");
  assert.deepEqual(ev.paths, ["api/x.cs"]);
  assert.equal(ev.detail, null);
});

test("NotebookEdit → write kind with notebook_path", () => {
  const ev = normalize(payload({ tool_name: "NotebookEdit", tool_input: { notebook_path: "D:\\Labs\\forgekit\\nb.ipynb" } }), NOW);
  assert.equal(ev.kind, "write");
  assert.deepEqual(ev.paths, ["nb.ipynb"]);
  assert.equal(ev.detail, null);
});

test("Glob → search kind with path and pattern detail", () => {
  const ev = normalize(payload({ tool_name: "Glob", tool_input: { path: "D:\\Labs\\forgekit\\api", pattern: "**/*.cs" } }), NOW);
  assert.equal(ev.kind, "search");
  assert.deepEqual(ev.paths, ["api"]);
  assert.equal(ev.detail, "**/*.cs");
});

test("Grep → search kind; missing path yields []", () => {
  const ev = normalize(payload({ tool_name: "Grep", tool_input: { pattern: "foo" } }), NOW);
  assert.equal(ev.kind, "search");
  assert.deepEqual(ev.paths, []);
  assert.equal(ev.detail, "foo");
});

test("Bash → exec kind with command detail and no paths", () => {
  const ev = normalize(payload({ tool_name: "Bash", tool_input: { command: "ls -la" } }), NOW);
  assert.equal(ev.kind, "exec");
  assert.deepEqual(ev.paths, []);
  assert.equal(ev.detail, "ls -la");
});

test("PowerShell → exec kind with command detail and no paths", () => {
  const ev = normalize(payload({ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } }), NOW);
  assert.equal(ev.kind, "exec");
  assert.deepEqual(ev.paths, []);
  assert.equal(ev.detail, "Get-ChildItem");
});

test("unknown tool → other kind with no paths and null detail", () => {
  const ev = normalize(payload({ tool_name: "WebFetch", tool_input: { url: "https://example.com" } }), NOW);
  assert.equal(ev.kind, "other");
  assert.deepEqual(ev.paths, []);
  assert.equal(ev.detail, null);
});

test("Windows path is made relative to cwd with / separators", () => {
  const ev = normalize(payload({ tool_name: "Read", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }), NOW);
  assert.deepEqual(ev.paths, ["api/x.cs"]);
});

test("drive letter and case differences do not break relativizing", () => {
  const ev = normalize(payload({ tool_name: "Read", tool_input: { file_path: "d:\\labs\\Forgekit\\a.ts" } }), NOW);
  assert.deepEqual(ev.paths, ["a.ts"]);
});

test("path outside cwd is kept absolute with / separators", () => {
  const ev = normalize(payload({ tool_name: "Read", tool_input: { file_path: "E:\\other\\b.ts" } }), NOW);
  assert.deepEqual(ev.paths, ["E:/other/b.ts"]);
});

test("POSIX path is made relative to cwd", () => {
  const ev = normalize(
    payload({ cwd: "/home/u/proj", tool_name: "Read", tool_input: { file_path: "/home/u/proj/a/b.ts" } }),
    NOW
  );
  assert.deepEqual(ev.paths, ["a/b.ts"]);
});

test("detail is truncated to 2000 characters (5000-char command)", () => {
  const cmd = "x".repeat(5000);
  const ev = normalize(payload({ tool_name: "Bash", tool_input: { command: cmd } }), NOW);
  assert.equal(ev.detail.length, 2000);
  assert.equal(ev.detail, cmd.slice(0, 2000));
});

test("payload {} does not throw and yields safe defaults", () => {
  const ev = normalize({}, NOW);
  assert.equal(ev.ts, "2026-10-09T08:00:00.000Z");
  assert.equal(ev.session, null);
  assert.equal(ev.agent, null);
  assert.equal(ev.event, null);
  assert.equal(ev.tool, null);
  assert.equal(ev.kind, "other");
  assert.deepEqual(ev.paths, []);
  assert.equal(ev.detail, null);
});

test("agent_id is passed through as agent", () => {
  const ev = normalize(payload({ agent_id: "sub-1" }), NOW);
  assert.equal(ev.agent, "sub-1");
});

test("root overrides cwd so paths stay stable after cd", () => {
  const ev = normalize(
    payload({ cwd: "D:\\Labs\\forgekit\\api", tool_name: "Read", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\x.cs" } }),
    NOW,
    CWD_WIN,
  );
  assert.deepEqual(ev.paths, ["api/x.cs"]);
});

test("dot-dot segments are collapsed before relativizing", () => {
  const ev = normalize(
    payload({ tool_name: "Edit", tool_input: { file_path: "D:\\Labs\\forgekit\\api\\..\\api\\Anvil\\.\\x.cs" } }),
    NOW,
  );
  assert.deepEqual(ev.paths, ["api/Anvil/x.cs"]);
});

test("events carry a comparable repo root", () => {
  const ev = normalize(payload({ tool_name: "Read", tool_input: { file_path: "D:\\Labs\\forgekit\\a.ts" } }), NOW, "D:\\Labs\\ForgeKit\\");
  assert.equal(ev.root, "d:/labs/forgekit");
  assert.equal(normalize({}, NOW).root, null);
});

test("events name their source, claude-code by default", () => {
  assert.equal(normalize({}, NOW).source, "claude-code");
  assert.equal(normalize({}, NOW, null, "pi").source, "pi");
});
