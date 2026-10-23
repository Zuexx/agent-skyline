// The Claude Code hook settings that connect a repo to Agent Skyline, and how to add them to (or
// take them out of) a settings file that may already hold other hooks.
//
// Agent Skyline's entries are recognised by the hook script they run, so merging twice does not
// duplicate them, and a stale entry (an older install path) is replaced rather than kept.

import path from "node:path";
import { fileURLToPath } from "node:url";

const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks");
// Windows separators become "/" (a "\" inside "..." is an escape in Git Bash); elsewhere "\" is an
// ordinary file name character and is kept.
const posix = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);

// Hook commands run through a shell: sh/bash (macOS, Linux, Git Bash) or cmd.exe. Inside "..."
// bash still expands $ ` \ and ends at ", and cmd.exe expands %VAR% and !VAR!. A path free of
// these is passed as-is; any other is passed base64url-encoded ([A-Za-z0-9_-], inert in every shell).
const SHELL_SAFE = /^[^"$`\\%!]*$/;

function rootOption(root) {
  const p = posix(path.resolve(root));
  return SHELL_SAFE.test(p) ? ` --root "${p}"` : ` --root-b64 ${Buffer.from(p, "utf8").toString("base64url")}`;
}

// The hook script path cannot be encoded (node needs it as written), so refuse one the shell would
// mangle instead of writing hooks that silently never run.
function script(name) {
  const p = posix(path.join(hooksDir, name));
  const bad = process.platform === "win32" ? /["$`%]/ : /["$`\\]/;
  if (bad.test(p)) throw new Error(`Agent Skyline is installed at ${hooksDir}; a shell cannot run hooks from a path containing ${p.match(bad)[0]}. Move the Agent Skyline folder to a path without " $ \` % \\ and run it again.`);
  return `node "${p}"`;
}

/**
 * The hook settings for the given options. `root` is the repo the hooks report to: the folder the
 * server serves. Without it the hooks fall back to the session's project dir, which differs from
 * the repo root when Claude Code is started in a subfolder (see lib/hookRoot.mjs).
 */
export function hookSettings({ autostart = false, open = false, port = null, root = null } = {}) {
  const rootFlag = root ? rootOption(root) : "";
  const hook = (name) => `${script(name)}${rootFlag}`;
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell", hooks: [{ type: "command", command: hook("guard.mjs"), timeout: 10 }] },
      ],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
      // A new task: the prompt's first line names it on the timeline. Prints nothing, so nothing is
      // added to the prompt.
      UserPromptSubmit: [{ hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
      // "The agent is done and waiting for you": the city announces it with what the turn changed.
      Stop: [{ hooks: [{ type: "command", command: hook("log-event.mjs"), timeout: 10 }] }],
    },
  };
  if (autostart) {
    const extra = `${port ? ` --port ${port}` : ""}${open ? " --open" : ""}`;
    const command = `${script("session-start.mjs")}${extra}${rootFlag}`;
    settings.hooks.SessionStart = [{ hooks: [{ type: "command", command, timeout: 15 }] }];
  }
  return settings;
}

const SKYLINE_COMMAND = /[\\/]hooks[\\/](guard|log-event|session-start)\.mjs"/;

/** True for a hook group whose commands run an Agent Skyline hook script. */
export function isSkylineGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((h) => typeof h?.command === "string" && SKYLINE_COMMAND.test(h.command));
}

/**
 * The repo roots an Agent Skyline hook group reports to, read back from the `--root "<dir>"` or
 * `--root-b64 <b64>` that rootOption() wrote; null for a group from before --root (it reports to
 * the session's own folder).
 */
export function groupRoots(group) {
  const roots = [];
  for (const h of group?.hooks ?? []) {
    const c = typeof h?.command === "string" ? h.command : "";
    if (!SKYLINE_COMMAND.test(c)) continue;
    const plain = c.match(/ --root "([^"]+)"/);
    const b64 = c.match(/ --root-b64 ([A-Za-z0-9_-]+)/);
    if (plain) roots.push(plain[1]);
    else if (b64) roots.push(Buffer.from(b64[1], "base64url").toString("utf8"));
  }
  return roots.length ? roots : null;
}

/**
 * A copy of `settings` without Agent Skyline hook groups (all of them, or those `which(group)`
 * accepts); empty event lists and an empty `hooks` are dropped.
 */
export function removeHooks(settings, which = () => true) {
  const out = { ...settings };
  if (!out.hooks || typeof out.hooks !== "object") return out;
  const hooks = {};
  for (const [event, groups] of Object.entries(out.hooks)) {
    const kept = Array.isArray(groups) ? groups.filter((g) => !(isSkylineGroup(g) && which(g))) : groups;
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** A copy of `settings` with Agent Skyline's hooks (and only the current ones) added next to everything else. */
export function mergeHooks(settings, ours) {
  const out = removeHooks(settings ?? {}); // every Agent Skyline group: a stale one is replaced
  const hooks = { ...(out.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ours.hooks)) hooks[event] = [...(hooks[event] ?? []), ...groups];
  return { ...out, hooks };
}

/** True when `settings` already holds exactly the hook groups in `ours`. */
export function hasHooks(settings, ours) {
  const strip = (s) => JSON.stringify(Object.entries(s?.hooks ?? {}).map(([e, gs]) => [e, (gs ?? []).filter(isSkylineGroup)]).filter(([, gs]) => gs.length).sort());
  return strip(settings) === strip(ours);
}
