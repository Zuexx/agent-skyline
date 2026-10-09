// Scope check: flag writes that look out of place for the task.
//
// With a declared scope (globs the task may change), any write outside it is flagged.
// Without one, two explainable rules infer it from the session itself:
// - blindWrite: an existing file is changed although this agent never read it in the session.
//   (Claude Code's Edit tool already insists on a prior read, so this mostly catches changes seen
//   only by the file watcher and agents without that rule.)
// - newArea: after the agent has settled into some areas (MIN_EVENTS), it writes into an area it
//   has not touched at all this session. An area is the first two folder levels ("api/Anvil").
// Warnings never block anything; blocking is what locked zones are for.
import { matchGlob } from "../../../lib/glob.mjs";
import { agentKeyOf } from "./activity.js";

export const MIN_EVENTS = 5;

/** "api/Anvil/Data/x.cs" -> "api/Anvil"; "README.md" -> "" (repo root). */
export function areaOf(path) {
  const parts = String(path).split("/");
  parts.pop(); // file name
  return parts.slice(0, 2).join("/");
}

/** Feed entry key a warning attaches to. */
export const warningKey = (ev, path) => `${ev.ts}|${path}`;

/**
 * Warnings for the feed (newest-first, as activity keeps it). Returns a Map warningKey -> warning
 * { rule, path, agent, ts }. `declared`: allowed globs, or null/[] for "infer". `known`: Set of
 * paths that existed before (new files cannot have been read, so they are never "blind").
 */
export function computeWarnings(feed, { declared = null, known = new Set(), minEvents = MIN_EVENTS } = {}) {
  const out = new Map();
  const agents = new Map(); // agentKey -> { reads: Set, areas: Set, seen: number }
  const useDeclared = Array.isArray(declared) && declared.length > 0;

  for (let i = (feed?.length ?? 0) - 1; i >= 0; i--) {
    const ev = feed[i];
    const key = agentKeyOf(ev);
    if (!agents.has(key)) agents.set(key, { reads: new Set(), areas: new Set(), seen: 0 });
    const a = agents.get(key);

    const reads = ev.kind === "read" ? ev.paths ?? [] : ev.readPaths ?? [];
    for (const p of reads) {
      a.reads.add(p);
      a.areas.add(areaOf(p));
    }

    if (ev.kind === "write") {
      for (const p of ev.paths ?? []) {
        let rule = null;
        if (useDeclared) {
          if (!declared.some((g) => matchGlob(g, p))) rule = "outOfScope";
        } else if (known.has(p) && !a.reads.has(p)) {
          rule = "blindWrite";
        } else if (a.seen >= minEvents && !a.areas.has(areaOf(p))) {
          rule = "newArea";
        }
        if (rule) out.set(warningKey(ev, p), { rule, path: p, agent: key, ts: ev.ts });
        a.reads.add(p); // once written, the agent knows the file
        a.areas.add(areaOf(p));
      }
    }
    if (["read", "write", "blocked", "exec", "search"].includes(ev.kind)) a.seen += 1;
  }
  return out;
}
