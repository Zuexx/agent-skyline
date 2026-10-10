// Agent Skyline adapter for pi (https://pi.dev): the pi equivalent of the two Claude Code hooks.
// - tool_call (before a tool runs): a write/edit into a locked zone is blocked, and the block is
//   logged, exactly like hooks/guard.mjs.
// - tool_execution_end (after it ran): the call is logged, exactly like hooks/log-event.mjs.
// pi events are translated into the Claude Code hook payload shape and passed through the same
// normalize() and decide(), so both agents are judged by one rulebook.
//
// Load for one run:   pi --extension D:/Labs/game-view-ideas/adapters/pi/agent-skyline.js
// Load always:        copy (or import) this file from ~/.pi/agent/extensions/
//
// Never throws out of a handler for logging problems: pi treats a failing tool_call handler as a
// block, and a broken log must not stop the agent. Zone decisions follow guard.mjs: an invalid
// zones file fails closed.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalize } from "../../lib/normalize.mjs";
import { resolveLogFile, resolveZonesFile } from "../../lib/paths.mjs";
import { decide, decideCommand, loadZones } from "../../lib/zones.mjs";

// pi built-in tool -> the Claude Code tool name normalize() understands.
const TOOL = { read: "Read", write: "Write", edit: "Edit", bash: "Bash", grep: "Grep", find: "Glob", ls: "LS" };

/** Claude Code hook payload for a pi tool call. Exported for tests. */
export function toPayload(toolName, input, ctx, hookEvent) {
  const args = input && typeof input === "object" ? input : {};
  const session = (() => {
    try {
      return ctx?.sessionManager?.getSessionId?.() ?? null;
    } catch {
      return null;
    }
  })();
  return {
    session_id: session ? `pi-${session}` : "pi",
    cwd: ctx?.cwd,
    hook_event_name: hookEvent,
    tool_name: TOOL[toolName] ?? toolName,
    tool_input: {
      file_path: args.path ?? args.file_path,
      path: args.path,
      pattern: args.pattern,
      command: args.command,
    },
  };
}

async function append(event) {
  const file = resolveLogFile();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(event) + "\n", "utf8");
}

export default function agentSkyline(pi) {
  pi.on("tool_call", async (event, ctx) => {
    const isBash = event.toolName === "bash";
    if (event.toolName !== "write" && event.toolName !== "edit" && !isBash) return undefined;
    const ev = normalize(toPayload(event.toolName, event.input, ctx, "PreToolUse"), new Date(), ctx?.cwd, "pi");
    const zones = await loadZones(resolveZonesFile());
    // bash can write into a zone just as well as edit can (a blocked model did exactly that).
    const decision = isBash ? decideCommand(event.input?.command, ctx?.cwd, ctx?.cwd, zones) : decide(ev, zones);
    if (decision.allow) return undefined;
    if (isBash) ev.paths = decision.paths;
    try {
      await append({ ...ev, kind: "blocked", detail: decision.reason });
    } catch {
      // the block stands even if it cannot be logged
    }
    if (ctx?.hasUI) ctx.ui.notify(decision.reason, "warning");
    return { block: true, reason: decision.reason };
  });

  // tool_execution_end carries no arguments (only the result), so remember them from
  // tool_execution_start by call id. A call that failed — including one blocked above, which pi
  // reports as an error result — is not logged as having read or written anything.
  const argsById = new Map();
  pi.on("tool_execution_start", (event) => {
    argsById.set(event.toolCallId, event.args);
  });

  // The agent finished and is waiting for the person: logged like Claude Code's Stop hook.
  pi.on("agent_end", async (_event, ctx) => {
    try {
      await append(normalize(toPayload(null, {}, ctx, "Stop"), new Date(), ctx?.cwd, "pi"));
    } catch {
      // logging is best effort
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const args = argsById.get(event.toolCallId);
    argsById.delete(event.toolCallId);
    if (event.isError) return;
    try {
      const ev = normalize(toPayload(event.toolName, args, ctx, "PostToolUse"), new Date(), ctx?.cwd, "pi");
      await append(ev);
    } catch {
      // logging is best effort
    }
  });
}
