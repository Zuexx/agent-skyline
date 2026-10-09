// Print (or write) the Claude Code hook settings that connect a repo to CodeCity.
//
//   node cli/install-hooks.mjs <repo>            print the settings to paste
//   node cli/install-hooks.mjs <repo> --write    write <repo>/.claude/settings.local.json
//
// --write refuses to overwrite an existing settings.local.json (merge by hand instead), and
// reminds you to make sure the file is git-ignored in that repo.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = (name) => `node "${path.join(here, "..", "hooks", name).replace(/\\/g, "/")}"`;

const settings = {
  hooks: {
    PreToolUse: [
      { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: hook("guard.mjs"), timeout: 10 }] },
    ],
    PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
  },
};

const [repo, flag] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node cli/install-hooks.mjs <repo> [--write]");
  process.exit(1);
}
const text = JSON.stringify(settings, null, 2) + "\n";
if (flag !== "--write") {
  console.log(text);
  process.exit(0);
}
const target = path.join(repo, ".claude", "settings.local.json");
if (existsSync(target)) {
  console.error(`${target} already exists; not overwriting. Merge this into it:\n\n${text}`);
  process.exit(1);
}
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, text, "utf8");
console.log(`wrote ${target}\nMake sure .claude/settings.local.json is git-ignored in that repo.`);
