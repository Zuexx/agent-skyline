// Print (or write) the Claude Code hook settings that connect a repo to Agent Skyline.
//
//   node cli/install-hooks.mjs <repo>            print the settings to paste
//   node cli/install-hooks.mjs <repo> --write    write <repo>/.claude/settings.local.json
//
// Options (off by default):
//   --autostart   also add a SessionStart hook that starts a Agent Skyline server for the repo when a
//                 Claude Code session begins (reusing one that is already running)
//   --open        with --autostart: open the city in the browser when the hook starts a server
//   --port <n>    with --autostart: first port to try (default 4477)
//
// --write refuses to overwrite an existing settings.local.json (merge by hand instead), and
// reminds you to make sure the file is git-ignored in that repo.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = (name) => `node "${path.join(here, "..", "hooks", name).replace(/\\/g, "/")}"`;

/** The hook settings for the given options. */
export function hookSettings({ autostart = false, open = false, port = null } = {}) {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell", hooks: [{ type: "command", command: hook("guard.mjs"), timeout: 10 }] },
      ],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
      // "The agent is done and waiting for you": the city announces it with what the turn changed.
      Stop: [{ hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
    },
  };
  if (autostart) {
    const extra = `${port ? ` --port ${port}` : ""}${open ? " --open" : ""}`;
    settings.hooks.SessionStart = [{ hooks: [{ type: "command", command: hook("session-start.mjs") + extra, timeout: 15 }] }];
  }
  return settings;
}

async function main() {
  const args = process.argv.slice(2);
  const repo = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const portAt = args.indexOf("--port");
  const opts = { autostart: args.includes("--autostart"), open: args.includes("--open"), port: portAt >= 0 ? Number(args[portAt + 1]) : null };
  if (!repo || (opts.port != null && !Number.isInteger(opts.port))) {
    console.error("usage: node cli/install-hooks.mjs <repo> [--write] [--autostart [--open] [--port <n>]]");
    process.exit(1);
  }
  if (opts.open && !opts.autostart) console.error("note: --open only applies with --autostart");
  const text = JSON.stringify(hookSettings(opts), null, 2) + "\n";
  if (!args.includes("--write")) {
    console.log(text);
    return;
  }
  const target = path.join(repo, ".claude", "settings.local.json");
  if (existsSync(target)) {
    console.error(`${target} already exists; not overwriting. Merge this into it:\n\n${text}`);
    process.exit(1);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
  console.log(`wrote ${target}\nMake sure .claude/settings.local.json is git-ignored in that repo.`);
}

// Importable for tests; runs only as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
