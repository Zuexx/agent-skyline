// Alerts: the events worth interrupting someone for. Today: a write blocked by a locked zone, and
// a write the scope check flags. Pure, so the toast list and desktop notifications share one source.
import { agentKeyOf, sourceOf } from "./activity.js";
import { warningKey } from "./scope.js";

export const FRESH_MS = 15_000; // older alerts (e.g. replayed history) are listed, never announced

/**
 * Alerts newest-first: { key, level: "block"|"warn", rule, path, ts, agent, source, reason }.
 * `warnings` is computeWarnings()'s Map (may be null).
 */
export function alertsFrom(feed, warnings = null) {
  const out = [];
  for (const ev of feed ?? []) {
    if (ev.kind === "blocked") {
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
          out.push({ key: `warn|${ev.ts}|${p}`, level: "warn", rule: w.rule, path: p, ts: ev.ts, agent: w.agent, source: sourceOf(ev), reason: null });
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
