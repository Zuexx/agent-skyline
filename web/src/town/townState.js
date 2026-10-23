// What the painted town shows (specs/09): which character stands at which building doing what, and
// which buildings were changed recently. Built from the page's activity state (lib/activity.js), so
// the town follows the same events as the rest of the page. Pure, no React, no three.js.

export const CHARACTERS = ["hero", "mage", "priest"]; // by order of first appearance (spec 09)
export const ACTIVE_MS = 3 * 60_000; // an agent with no event for this long goes home (idle)
export const RECENT_MS = 30 * 60_000; // a building written to within this window is "recent"

const ACTIONS = { write: "write", read: "read", blocked: "blocked" };

function isRepoPath(p) {
  return typeof p === "string" && p.length > 0 && !p.startsWith("/") && !/^[a-z]:[\\/]/i.test(p);
}

/**
 * The building that holds repo path `p`: the longest building id that is the path's folder or one
 * above it; "(root)" (the town hall) when none is. null for paths outside the repo.
 */
export function buildingOf(p, buildingIds) {
  if (!isRepoPath(p)) return null;
  let best = null;
  for (const id of buildingIds) {
    if (id !== "(root)" && (p === id || p.startsWith(id + "/")) && (!best || id.length > best.length)) best = id;
  }
  return best ?? "(root)";
}

/**
 * { agents: [{ key, character, building, action }], recent: [building ids] } for `activity`
 * (lib/activity.js state). `agentSeq` numbers agents by first appearance (1-based); `buildingIds`
 * are the pack's buildings; `nowMs` the clock.
 */
export function townState(activity, agentSeq, buildingIds, nowMs) {
  const agents = [];
  for (const [key, a] of Object.entries(activity?.agents ?? {})) {
    if (a.source === "watcher") continue; // changes no agent reported: no character (spec 09 §3.1)
    const building = buildingOf(a.path, buildingIds) ?? "(root)";
    const t = Date.parse(a.ts ?? "");
    const stale = Number.isNaN(t) || nowMs - t > ACTIVE_MS;
    const n = agentSeq?.[key] ?? agents.length + 1;
    agents.push({
      key,
      character: CHARACTERS[(n - 1) % CHARACTERS.length],
      building,
      action: stale ? "idle" : (ACTIONS[a.kind] ?? "idle"),
    });
  }
  const recent = new Set();
  for (const [p, f] of Object.entries(activity?.files ?? {})) {
    const t = Date.parse(f.lastWrite ?? "");
    if (!Number.isNaN(t) && nowMs - t < RECENT_MS) {
      const b = buildingOf(p, buildingIds);
      if (b) recent.add(b);
    }
  }
  return { agents, recent: [...recent].sort() };
}
