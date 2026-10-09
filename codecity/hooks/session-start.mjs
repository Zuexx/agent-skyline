// Claude Code SessionStart hook (opt-in, see cli/install-hooks.mjs --autostart): make sure a
// CodeCity server is watching this repo when a session starts, so the city is already there.
//
//   node hooks/session-start.mjs [--port 4477] [--open]
//
// --open opens the city in the browser, but only when this hook had to start the server: if one
// was already running, its page is most likely open already.
// Like the other hooks it never fails the session and prints nothing to stdout (SessionStart
// stdout would be added to Claude's context); problems go to stderr.

import { ensureServer, openBrowser } from "../lib/autostart.mjs";
import { resolveServersDir } from "../lib/paths.mjs";

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function fail(message) {
  try {
    process.stderr.write(`codecity session-start: ${message}\n`);
  } catch {
    // nothing else to do
  }
}

async function main() {
  const args = process.argv.slice(2);
  const portArg = args.indexOf("--port");
  const basePort = portArg >= 0 ? Number(args[portArg + 1]) : 4477;
  const open = args.includes("--open");

  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    // no usable payload: fall back to the project dir
  }
  const repo = process.env.CLAUDE_PROJECT_DIR || payload.cwd;
  if (!repo) return fail("no project directory");
  if (!Number.isInteger(basePort) || basePort <= 0) return fail(`bad --port ${args[portArg + 1]}`);

  const server = await ensureServer({ repo, basePort, serversDir: resolveServersDir() });
  if (!server) return fail(`ports ${basePort}-${basePort + 9} are all taken`);
  if (open && server.started) openBrowser(server.url);
}

try {
  await main();
} catch (err) {
  fail(err?.message ?? String(err));
}
