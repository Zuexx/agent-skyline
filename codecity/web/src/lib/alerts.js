// Alerts: the events worth interrupting someone for: a write blocked by a locked zone, a write the
// scope or conflict checks flag, and an agent finishing its turn (with what that turn changed).
// Pure, so the toast list and desktop notifications share one source.
import { agentKeyOf, sourceOf } from "./activity.js";
import { warningKey } from "./scope.js";

export const FRESH_MS = 15_000; // older alerts (e.g. replayed history) are listed, never announced

/**
 * What each agent's turn did, keyed by its stop event: Map stopKey -> { written: [paths],
 * warned, blocked }. A turn runs from the agent's previous stop (or its first event) to this one.
 */
export function turnSummaries(feed, warnings = null) {
  const out = new Map();
  const runs = new Map(); // agentKey -> { written: Set, warned, blocked }
  for (let i = (feed?.length ?? 0) - 1; i >= 0; i--) {
    const ev = feed[i];
    const agent = agentKeyOf(ev);
    if (!runs.has(agent)) runs.set(agent, { written: new Set(), warned: 0, blocked: 0 });
    const run = runs.get(agent);
    if (ev.kind === "write") {
      for (const p of ev.paths ?? []) {
        run.written.add(p);
        if (warnings?.has(warningKey(ev, p))) run.warned++;
      }
    } else if (ev.kind === "blocked") run.blocked++;
    else if (ev.kind === "stop") {
      out.set(stopKey(ev), { written: [...run.written].sort(), warned: run.warned, blocked: run.blocked });
      runs.set(agent, { written: new Set(), warned: 0, blocked: 0 });
    }
  }
  return out;
}

const stopKey = (ev) => `done|${ev.ts}|${agentKeyOf(ev)}`;

/**
 * Alerts newest-first: { key, level: "block"|"warn"|"done", rule, path, ts, agent, source, reason,
 * other?, otherSource?, summary? }. `warnings` is the Map of scope warnings and conflicts (may be
 * null).
 */
export function alertsFrom(feed, warnings = null) {
  const out = [];
  const turns = turnSummaries(feed, warnings);
  for (const ev of feed ?? []) {
    if (ev.kind === "stop") {
      out.push({
        key: stopKey(ev),
        level: "done",
        rule: "done",
        path: null,
        ts: ev.ts,
        agent: agentKeyOf(ev),
        source: sourceOf(ev),
        reason: null,
        summary: turns.get(stopKey(ev)) ?? { written: [], warned: 0, blocked: 0 },
      });
    } else if (ev.kind === "blocked") {
      const path = ev.paths?.[0] ?? null;
      out.push({
        key: `block|${ev.ts}|${path}`,
        level: "block",
        rule: "blocked",
        path,
        ts: ev.ts,
        agent: agentKeyOf(ev),
        source: sourceOf(ev),
        reason: ev.detail ?? null,
      });
    } else if (ev.kind === "write" && warnings) {
      for (const p of ev.paths ?? []) {
        const w = warnings.get(warningKey(ev, p));
        if (w) {
          out.push({
            key: `warn|${ev.ts}|${p}`,
            level: "warn",
            rule: w.rule,
            path: p,
            ts: ev.ts,
            agent: w.agent,
            source: sourceOf(ev),
            reason: null,
            other: w.other ?? null,
            otherSource: w.otherSource ?? null,
          });
        }
      }
    }
  }
  return out;
}

/** Alerts not seen before and recent enough to announce. Marks them seen. */
export function freshAlerts(alerts, seen, nowMs) {
  const out = [];
  for (const a of alerts) {
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    const age = nowMs - Date.parse(a.ts ?? "");
    if (age >= 0 && age < FRESH_MS) out.push(a);
  }
  return out;
}
