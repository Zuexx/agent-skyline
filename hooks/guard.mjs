// Claude Code PreToolUse hook entry point: reads a JSON payload from stdin,
// normalizes it, and decides whether the tool call touches a locked zone.
// On deny it prints exactly one permissionDecision JSON object to stdout and
// records the block in the event log; on allow (or any error) it prints
// nothing. Must always exit with code 0 so a failing hook never disturbs the
// agent being observed; errors go to stderr only.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { hookEvent, rootArg, rootSpellings } from "../lib/hookRoot.mjs";
import { resolveLogFile, resolveZonesFile } from "../lib/paths.mjs";
import { loadZones, decide, decideCommand } from "../lib/zones.mjs";

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function fail(message) {
  try {
    process.stderr.write(`agent-skyline guard: ${message}\n`);
  } catch {
    // stderr itself may be unavailable; the hook must still exit cleanly.
  }
}

// decideCommand against the root and, when the session's folder is another spelling of it (symlink,
// junction), against that spelling too: `echo > a.cs` run in <alias>/api is <alias>/api/a.cs.
function decideShell(command, cwd, root, zones) {
  const paths = new Set();
  for (const r of rootSpellings(root, cwd)) {
    const d = decideCommand(command, cwd, r, zones);
    if (!d.allow) return d;
    for (const p of d.paths) paths.add(p);
  }
  return { allow: true, paths: [...paths] };
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON on stdin: ${err.message}`);
    return;
  }
  const root = rootArg(process.argv.slice(2)); // the repo `skyline` connected, see lib/hookRoot.mjs
  const event = hookEvent(payload, new Date(), { root, projectDir: process.env.CLAUDE_PROJECT_DIR });
  const zones = await loadZones(resolveZonesFile());
  // Shell commands can write too (`echo > file`, `sed -i`, `rm`...): an agent blocked on Edit was
  // seen switching to exactly that. Check the full command, not the truncated event detail.
  const command = event.kind === "exec" ? payload?.tool_input?.command : null;
  const decision = command
    ? decideShell(command, payload.cwd, root || process.env.CLAUDE_PROJECT_DIR || payload.cwd, zones)
    : decide(event, zones);
  if (decision.allow) return;
  if (command) event.paths = decision.paths;

  // Deny: print exactly one JSON object to stdout.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason,
      },
    }) + "\n"
  );

  // Record the block in the event log; a write failure must not undo the deny.
  const blocked = { ...event, kind: "blocked", detail: decision.reason };
  const file = resolveLogFile();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(blocked) + "\n", "utf8");
  } catch (err) {
    fail(`could not write ${file}: ${err.message}`);
  }
}

try {
  await main();
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
