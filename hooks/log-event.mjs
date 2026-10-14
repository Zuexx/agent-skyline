// Claude Code hook entry point: reads a JSON payload from stdin, normalizes it,
// and appends one JSON line to the event log. Must always exit with code 0 and
// print nothing to stdout, even on invalid JSON or a write error; errors go to
// stderr only so a failing hook never disturbs the agent being observed.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { hookEvent, rootArg } from "../lib/hookRoot.mjs";
import { resolveLogFile } from "../lib/paths.mjs";

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function fail(message) {
  try {
    process.stderr.write(`agent-skyline log-event: ${message}\n`);
  } catch {
    // stderr itself may be unavailable; the hook must still exit cleanly.
  }
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
  // --root: the repo `skyline` connected (and serves); without it, the session's project dir.
  const event = hookEvent(payload, new Date(), { root: rootArg(process.argv.slice(2)), projectDir: process.env.CLAUDE_PROJECT_DIR });
  const file = resolveLogFile();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    fail(`could not write ${file}: ${err.message}`);
  }
}

try {
  await main();
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
