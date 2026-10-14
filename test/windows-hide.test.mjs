// On Windows the auto-started server runs detached with no console, so any console program it
// starts (git, mostly) without `windowsHide: true` pops up a console window that closes again.
// The window itself cannot be observed on macOS/Linux, so the rule is checked two ways:
//   1. at run time: the server-side git calls are made for real while child_process is wrapped,
//      and every call must have been passed windowsHide: true;
//   2. in the source: every child_process call in shipped code (including the CLI's, which are
//      not exercised here) must say windowsHide: true, and nothing may say windowsHide: false or
//      reach child_process under another name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { execFileSync as realExecFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["lib", "server", "hooks", "cli", "adapters"];
const NAMES = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"];

function sources(dir) {
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out; // a listed folder that does not exist
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// The argument text of the call whose "(" is at `open`, up to its matching ")".
function callText(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

test("the server's git calls really pass windowsHide: true (run time)", async (t) => {
  // The test repo is made before child_process is wrapped, so only the code under test is seen.
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-hide-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  realExecFileSync("git", ["init", "-q"], { cwd: dir });
  realExecFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c"], { cwd: dir });
  await writeFile(path.join(dir, "a.txt"), "x\n");
  await writeFile(path.join(dir, ".gitignore"), "ignored.txt\n");

  const cp = createRequire(import.meta.url)("node:child_process");
  const seen = [];
  const saved = {};
  for (const name of NAMES) {
    saved[name] = cp[name];
    cp[name] = function (...args) {
      const opts = args.find((a, i) => i > 0 && a && typeof a === "object" && !Array.isArray(a));
      seen.push({ name, cmd: args[0], sub: Array.isArray(args[1]) ? args[1][0] : null, windowsHide: opts?.windowsHide });
      return saved[name].apply(this, args);
    };
  }
  syncBuiltinESMExports(); // the modules below import the wrapped functions
  t.after(() => {
    Object.assign(cp, saved);
    syncBuiltinESMExports();
  });

  const git = await import("../server/git.mjs");
  const scan = await import("../server/scan.mjs");
  const watch = await import("../server/watch.mjs");
  const setup = await import("../lib/repoSetup.mjs");
  git.listBranches(dir);
  git.workingChanges(dir);
  git.churn(dir);
  scan.isWorkTree(dir);
  scan.scanRepo(dir);
  watch.notIgnored(dir, ["a.txt", "ignored.txt"]);
  setup.repoRoot(dir);
  await setup.ensureGitignored(dir);

  const gitCalls = seen.filter((c) => c.cmd === "git");
  const subcommands = new Set(gitCalls.map((c) => c.sub));
  for (const s of ["rev-parse", "ls-files", "check-ignore"]) assert.ok(subcommands.has(s), `git ${s} was not exercised: ${[...subcommands]}`);
  assert.ok(gitCalls.length >= 6, `expected the server's git calls, saw ${gitCalls.length}`);
  const visible = gitCalls.filter((c) => c.windowsHide !== true).map((c) => `${c.name} git ${c.sub}`);
  assert.deepEqual(visible, [], "these git calls would flash a console window on Windows");
});

test("every child process started by shipped code sets windowsHide: true (source)", () => {
  const calls = [];
  const problems = [];
  for (const file of DIRS.flatMap((d) => sources(path.join(root, d)))) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, ""); // comments may say "windowsHide: ..."
    if (/windowsHide\s*:(?!\s*true\b)/.test(code)) problems.push(`${rel}: windowsHide set to something other than true`);
    const usesCp = /["'](node:)?child_process["']/.test(src);
    if (!usesCp) continue;
    // Only named imports under their own names, so the call scan below sees every call.
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+["'](?:node:)?child_process["']/g)) {
      if (!/^\{[^}]*\}$/.test(m[1]) || /\bas\b/.test(m[1])) problems.push(`${rel}: child_process imported as "${m[1]}"; import the functions by name`);
    }
    if (/require\(\s*["'](node:)?child_process["']\s*\)|import\(\s*["'](node:)?child_process["']\s*\)/.test(src)) problems.push(`${rel}: child_process loaded dynamically; import the functions by name`);
    const re = new RegExp(`(?<![.\\w])(${NAMES.join("|")})\\(`, "g");
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      calls.push({ where: `${rel}:${line} ${m[1]}`, text: callText(src, m.index + m[1].length) });
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(calls.length >= 8, `expected to find the known child_process calls, found ${calls.length}`);
  const missing = calls.filter((c) => !/windowsHide:\s*true/.test(c.text)).map((c) => c.where);
  assert.deepEqual(missing, [], "these calls would flash a console window on Windows");
});
