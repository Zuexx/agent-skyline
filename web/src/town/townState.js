// What the painted town shows (specs/09): which character stands at which building doing what, and
// which buildings were changed recently. Built from the page's activity state (lib/activity.js), so
// the town follows the same events as the rest of the page. Pure, no React, no three.js.
import { computeConflicts } from "../lib/conflicts.js";
import { matchGlob } from "../lib/zones.js";

export const CHARACTERS = ["hero", "mage", "priest"]; // by order of first appearance (spec 09)
export const ACTIVE_MS = 3 * 60_000; // an agent with no event for this long goes home (idle)
export const GONE_MS = 10 * 60_000; // ...and after this long it leaves the town (spec 09 §3.2)
export const RECENT_MS = 30 * 60_000; // a building written to within this window is "recent"
export const CONFLICT_SHOW_MS = 5000; // how long the sparks of a conflict show (spec 09 §3.2)

const ACTIONS = { write: "write", read: "read", blocked: "blocked" };
// Folders whose name says they hold the tests: where test results show when the command names none.
const TEST_FOLDER = /(^|\/)(tests?|__tests__)$/;

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
 * The buildings a search over `dir` looks through: the one holding it and every building inside
 * it; every building when the search names no folder (the whole repo).
 */
export function searchedBuildings(dir, buildingIds) {
  if (!isRepoPath(dir) || dir === ".") return [...buildingIds];
  const d = dir.replace(/\/+$/, "");
  const out = new Set(buildingIds.filter((id) => id === d || id.startsWith(d + "/")));
  const holder = buildingOf(d, buildingIds);
  if (holder) out.add(holder);
  return [...out];
}

const tsOf = (ev) => {
  const t = Date.parse(ev?.ts ?? "");
  return Number.isNaN(t) ? null : t;
};
const keyOf = (ev) => ev?.agent ?? ev?.session ?? "unknown";

/**
 * What each agent did last, from the feed (newest first): its newest event, its newest command
 * that is not a read through the shell (it casts), its newest search, and whether the turn its
 * newest Stop ended had writes in it (it cheers).
 */
function agentEvents(feed) {
  const out = new Map();
  for (const ev of feed ?? []) {
    if ((ev.source ?? "claude-code") === "watcher") continue;
    const key = keyOf(ev);
    let e = out.get(key);
    if (!e) out.set(key, (e = { latest: ev, cast: null, search: null, stopOpen: ev.kind === "stop", wrote: false }));
    else if (e.stopOpen) {
      // older than the newest Stop: the turn it ended runs back to the Stop before it
      if (ev.kind === "stop") e.stopOpen = false;
      else if (ev.kind === "write") e.wrote = true;
    }
    if (ev.kind === "exec" && !e.cast && (ev.check || !(ev.readPaths ?? []).length)) e.cast = ev;
    if (ev.kind === "search" && !e.search) e.search = ev;
  }
  return out;
}

/**
 * Test results per building: the newest check command's outcome ("passed" | "failed" | null) and
 * when, shown on the building of the files the command names, else on the test folder, else where
 * the agent was. `where`: agent key -> its building.
 */
function testResults(feed, buildingIds, where) {
  const testHome = buildingIds.find((id) => TEST_FOLDER.test(id)) ?? null;
  const out = {};
  for (const ev of feed ?? []) {
    if (ev.kind !== "exec" || !ev.check) continue;
    const named = (ev.readPaths ?? []).map((p) => buildingOf(p, buildingIds)).find(Boolean);
    const b = named ?? testHome ?? where.get(keyOf(ev)) ?? "(root)";
    if (!(b in out)) out[b] = { outcome: ev.outcome ?? null, at: tsOf(ev) };
  }
  return out;
}

/**
 * { agents, recent, tests, conflicts } for `activity` (lib/activity.js state):
 * - agents: [{ key, character, building, action, at, cast, search, cheer }]. action is write / read /
 *   blocked / cast (a shell command) / search / wait (stopped, waiting for the person) / idle. at is
 *   the agent's newest event (ms); cast: ms of its newest command; search: { at, buildings } of its
 *   newest search; cheer: ms of a Stop that ended a turn with writes. The renderer decides from these
 *   times how long each effect shows.
 * - recent: building ids written to within RECENT_MS.
 * - tests: { [building]: { outcome, at } }, the last test or build run shown on each building.
 * - conflicts: [{ building, at }], two agents writing the same file, newest first.
 * `agentSeq` numbers agents by first appearance (1-based); `buildingIds` are the pack's buildings;
 * `nowMs` the clock; `prompts`: agent key -> { at: ms } of its latest prompt (a prompt after a Stop
 * ends the wait).
 */
export function townState(activity, agentSeq, buildingIds, nowMs, prompts = {}) {
  const evs = agentEvents(activity?.feed);
  const keys = new Set(Object.keys(activity?.agents ?? {}));
  for (const k of evs.keys()) keys.add(k);
  const agents = [];
  const where = new Map();
  for (const key of keys) {
    const a = activity?.agents?.[key];
    if (a?.source === "watcher") continue; // changes no agent reported: no character (spec 09 §3.1)
    const e = evs.get(key);
    const building = buildingOf(a?.path, buildingIds) ?? "(root)";
    where.set(key, building);
    const at = Math.max(Date.parse(a?.ts ?? "") || 0, tsOf(e?.latest) ?? 0) || null;
    if (at == null || nowMs - at > GONE_MS) continue;
    let action = ACTIONS[a?.kind] ?? "idle";
    const latest = e?.latest;
    const prompted = (prompts?.[key]?.at ?? 0) > (tsOf(latest) ?? 0);
    if (latest?.kind === "stop") action = prompted ? "idle" : "wait";
    else if (latest?.kind === "search") action = "search";
    else if (latest && latest === e.cast) action = "cast";
    if (action !== "wait" && nowMs - at > ACTIVE_MS) action = "idle";
    const n = agentSeq?.[key] ?? agents.length + 1;
    agents.push({
      key,
      character: CHARACTERS[(n - 1) % CHARACTERS.length],
      building,
      action,
      at,
      cast: tsOf(e?.cast),
      search: e?.search ? { at: tsOf(e.search), buildings: searchedBuildings(e.search.paths?.[0], buildingIds) } : null,
      cheer: latest?.kind === "stop" && e.wrote ? tsOf(latest) : null,
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
  const conflicts = [];
  for (const c of computeConflicts(activity?.feed ?? []).values()) {
    const t = Date.parse(c.ts ?? "");
    const b = buildingOf(c.path, buildingIds);
    if (b && !Number.isNaN(t) && nowMs - t < CONFLICT_SHOW_MS + 10_000) conflicts.push({ building: b, at: t });
  }
  conflicts.sort((x, y) => y.at - x.at);
  return { agents, recent: [...recent].sort(), tests: testResults(activity?.feed, buildingIds, where), conflicts };
}

// Uncommitted changes in a building: this many files or more is a big change (spec 09 §4).
export const BIG_CHANGE = 10;

/**
 * What stands on each building without an agent there (spec 09 §4): { [building]: { changes,
 * level, locked, scope } }, only for buildings with something to show. changes: files with
 * uncommitted changes (`working`, the Map path -> change from /api/working); level 0-3 for the
 * scaffold (none / 1-2 files / 3-9 / BIG_CHANGE or more); locked: the whole folder is in a locked
 * zone (`locked` globs); scope: the folder is inside the declared task scope (`allow` globs).
 */
export function houseStates(buildingIds, { working = null, locked = [], allow = [] } = {}) {
  const out = {};
  const at = (id) => (out[id] ??= { changes: 0, level: 0, locked: false, scope: false });
  for (const p of working?.keys?.() ?? []) {
    const b = buildingOf(p, buildingIds);
    if (b) at(b).changes++;
  }
  // a folder counts as covered when a file directly in it would match
  const covered = (id, globs) => globs.some((g) => matchGlob(g, id === "(root)" ? "_" : `${id}/_`));
  for (const id of buildingIds) {
    if (locked.length && covered(id, locked)) at(id).locked = true;
    if (allow.length && covered(id, allow)) at(id).scope = true;
  }
  for (const h of Object.values(out)) h.level = h.changes === 0 ? 0 : h.changes < 3 ? 1 : h.changes < BIG_CHANGE ? 2 : 3;
  return out;
}
