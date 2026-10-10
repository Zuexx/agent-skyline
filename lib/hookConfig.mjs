// The Claude Code hook settings that connect a repo to Agent Skyline, and how to add them to (or
// take them out of) a settings file that may already hold other hooks.
//
// Agent Skyline's entries are recognised by the hook script they run, so merging twice does not
// duplicate them, and a stale entry (an older install path) is replaced rather than kept.

import path from "node:path";
import { fileURLToPath } from "node:url";

const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks");
const hook = (name) => `node "${path.join(hooksDir, name).replace(/\\/g, "/")}"`;

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

const SKYLINE_COMMAND = /[\\/]hooks[\\/](guard|log-event|session-start)\.mjs"/;

/** True for a hook group whose commands run an Agent Skyline hook script. */
export function isSkylineGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((h) => typeof h?.command === "string" && SKYLINE_COMMAND.test(h.command));
}

/** A copy of `settings` without any Agent Skyline hook groups; empty event lists and an empty `hooks` are dropped. */
export function removeHooks(settings) {
  const out = { ...settings };
  if (!out.hooks || typeof out.hooks !== "object") return out;
  const hooks = {};
  for (const [event, groups] of Object.entries(out.hooks)) {
    const kept = Array.isArray(groups) ? groups.filter((g) => !isSkylineGroup(g)) : groups;
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** A copy of `settings` with Agent Skyline's hooks (and only the current ones) added next to everything else. */
export function mergeHooks(settings, ours) {
  const out = removeHooks(settings ?? {});
  const hooks = { ...(out.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ours.hooks)) hooks[event] = [...(hooks[event] ?? []), ...groups];
  return { ...out, hooks };
}

/** True when `settings` already holds exactly the hook groups in `ours`. */
export function hasHooks(settings, ours) {
  const strip = (s) => JSON.stringify(Object.entries(s?.hooks ?? {}).map(([e, gs]) => [e, (gs ?? []).filter(isSkylineGroup)]).filter(([, gs]) => gs.length).sort());
  return strip(settings) === strip(ours);
}
