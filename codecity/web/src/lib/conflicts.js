// Conflicts between agents: two different agents writing the same file within a short window
// usually means they are working against each other (one overwrites the other's change, or a
// merge is coming). Reported in the same shape as scope warnings, so the feed, the warning caps,
// the review list and the alerts pick them up unchanged. The file watcher is no agent: a change
// it saw cannot be attributed, so it never takes part.
import { agentKeyOf, sourceOf } from "./activity.js";
import { warningKey } from "./scope.js";

export const CONFLICT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Map warningKey -> { rule: "conflict", path, agent, ts, other, otherSource } for every write
 * that follows another agent's write to the same file within `windowMs`. `feed` is newest-first.
 */
export function computeConflicts(feed, windowMs = CONFLICT_WINDOW_MS) {
  const out = new Map();
  const lastWrite = new Map(); // path -> { agent, source, t }
  for (let i = (feed?.length ?? 0) - 1; i >= 0; i--) {
    const ev = feed[i];
    if (ev.kind !== "write" || sourceOf(ev) === "watcher") continue;
    const t = Date.parse(ev.ts ?? "");
    if (Number.isNaN(t)) continue;
    const agent = agentKeyOf(ev);
    for (const p of ev.paths ?? []) {
      const prev = lastWrite.get(p);
      if (prev && prev.agent !== agent && t - prev.t <= windowMs) {
        out.set(warningKey(ev, p), { rule: "conflict", path: p, agent, ts: ev.ts, other: prev.agent, otherSource: prev.source });
      }
      lastWrite.set(p, { agent, source: sourceOf(ev), t });
    }
  }
  return out;
}
