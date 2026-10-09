import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import codecity, { toPayload } from "../adapters/pi/codecity.js";

// A stand-in for pi's ExtensionAPI: collects handlers so the test can fire events.
function fakePi() {
  const handlers = {};
  return { on: (name, fn) => (handlers[name] = fn), fire: (name, event, ctx) => handlers[name](event, ctx) };
}

const ctx = (cwd) => ({ cwd, hasUI: false, sessionManager: { getSessionId: () => "abc" } });

async function setup(t, zones) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codecity-pi-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.CODECITY_EVENTS = path.join(dir, "events.jsonl");
  process.env.CODECITY_ZONES = path.join(dir, "zones.json");
  t.after(() => {
    delete process.env.CODECITY_EVENTS;
    delete process.env.CODECITY_ZONES;
  });
  if (zones) await writeFile(process.env.CODECITY_ZONES, JSON.stringify(zones));
  const pi = fakePi();
  codecity(pi);
  return { pi, repo: path.join(dir, "repo") };
}

const logged = async () =>
  (await readFile(process.env.CODECITY_EVENTS, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("toPayload maps pi tools onto the Claude Code hook shape", () => {
  const p = toPayload("edit", { path: "/r/a.ts" }, ctx("/r"), "PreToolUse");
  assert.deepEqual(
    { session: p.session_id, tool: p.tool_name, file: p.tool_input.file_path },
    { session: "pi-abc", tool: "Edit", file: "/r/a.ts" }
  );
  assert.equal(toPayload("bash", { command: "ls" }, ctx("/r"), "PostToolUse").tool_input.command, "ls");
});

test("finished tool calls are logged as pi events with repo-relative paths", async (t) => {
  const { pi, repo } = await setup(t);
  // As in pi: arguments arrive with tool_execution_start; tool_execution_end only has the result.
  pi.fire("tool_execution_start", { toolCallId: "1", toolName: "read", args: { path: path.join(repo, "src", "a.ts") } }, ctx(repo));
  await pi.fire("tool_execution_end", { toolCallId: "1", toolName: "read", result: {}, isError: false }, ctx(repo));
  pi.fire("tool_execution_start", { toolCallId: "2", toolName: "bash", args: { command: "cat src/a.ts" } }, ctx(repo));
  await pi.fire("tool_execution_end", { toolCallId: "2", toolName: "bash", result: {}, isError: false }, ctx(repo));
  // A failed (e.g. blocked) call is not logged as a read or write.
  pi.fire("tool_execution_start", { toolCallId: "3", toolName: "edit", args: { path: path.join(repo, "src", "a.ts") } }, ctx(repo));
  await pi.fire("tool_execution_end", { toolCallId: "3", toolName: "edit", result: {}, isError: true }, ctx(repo));
  const evs = await logged();
  assert.deepEqual(
    evs.map((e) => [e.source, e.kind, e.paths, e.session]),
    [
      ["pi", "read", ["src/a.ts"], "pi-abc"],
      ["pi", "exec", [], "pi-abc"],
    ]
  );
});

test("a write into a locked zone is blocked and logged; other writes pass", async (t) => {
  const { pi, repo } = await setup(t, { locked: ["api/**"] });
  const blocked = await pi.fire("tool_call", { toolName: "write", input: { path: path.join(repo, "api", "x.cs") } }, ctx(repo));
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /locked zone "api\/\*\*"/);
  const allowed = await pi.fire("tool_call", { toolName: "edit", input: { path: path.join(repo, "app", "y.ts") } }, ctx(repo));
  assert.equal(allowed, undefined);
  const read = await pi.fire("tool_call", { toolName: "read", input: { path: path.join(repo, "api", "x.cs") } }, ctx(repo));
  assert.equal(read, undefined); // reading a locked file is fine
  assert.deepEqual((await logged()).map((e) => [e.kind, e.source, e.paths[0]]), [["blocked", "pi", "api/x.cs"]]);
});

test("an invalid zones file blocks writes (fails closed, like the Claude guard)", async (t) => {
  const { pi, repo } = await setup(t);
  await writeFile(process.env.CODECITY_ZONES, "{ not json");
  const r = await pi.fire("tool_call", { toolName: "write", input: { path: path.join(repo, "a.ts") } }, ctx(repo));
  assert.equal(r.block, true);
});

test("a bash command that would write into a locked zone is blocked too", async (t) => {
  const { pi, repo } = await setup(t, { locked: ["locked/**"] });
  const r = await pi.fire("tool_call", { toolName: "bash", input: { command: "echo '// touched' > locked/secret.ts" } }, ctx(repo));
  assert.equal(r.block, true);
  const ok = await pi.fire("tool_call", { toolName: "bash", input: { command: "cat locked/secret.ts" } }, ctx(repo));
  assert.equal(ok, undefined);
  assert.deepEqual((await logged()).map((e) => [e.kind, e.tool, e.paths[0]]), [["blocked", "Bash", "locked/secret.ts"]]);
});
