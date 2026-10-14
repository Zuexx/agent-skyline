// Print (or write) the Claude Code hook settings that connect a repo to Agent Skyline.
// Most people want `skyline` (cli/skyline.mjs) instead, which also starts the city.
//
//   node cli/install-hooks.mjs <repo>            print the settings to paste
//   node cli/install-hooks.mjs <repo> --write    add them to <repo>/.claude/settings.local.json
//
// Options (off by default):
//   --autostart   also add a SessionStart hook that starts an Agent Skyline server for the repo when a
//                 Claude Code session begins (reusing one that is already running)
//   --open        with --autostart: open the city in the browser when the hook starts a server
//   --port <n>    with --autostart: first port to try (default 4477)
//
// --write keeps everything else already in settings.local.json and replaces only Agent Skyline's
// own hooks, and reminds you to make sure the file is git-ignored in that repo.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookSettings } from "../lib/hookConfig.mjs";
import { writeRepoHooks } from "../lib/repoSetup.mjs";

export { hookSettings };

async function main() {
  const args = process.argv.slice(2);
  const repo = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const portAt = args.indexOf("--port");
  // root: events are reported for <repo>, the folder to run the server with (--repo), even when the hooks are written into another folder's settings.
  const opts = { autostart: args.includes("--autostart"), open: args.includes("--open"), port: portAt >= 0 ? Number(args[portAt + 1]) : null, root: repo };
  if (!repo || (opts.port != null && !Number.isInteger(opts.port))) {
    console.error("usage: node cli/install-hooks.mjs <repo> [--write] [--autostart [--open] [--port <n>]]");
    process.exit(1);
  }
  if (opts.open && !opts.autostart) console.error("note: --open only applies with --autostart");
  if (!args.includes("--write")) {
    console.log(JSON.stringify(hookSettings(opts), null, 2));
    return;
  }
  const { file } = await writeRepoHooks(repo, hookSettings(opts));
  console.log(`wrote ${file}\nMake sure .claude/settings.local.json is git-ignored in that repo.`);
}

// Importable for tests; runs only as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
