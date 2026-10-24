// What the painted town shows (specs/09): which character stands at which building doing what, and
// which buildings were changed recently. Built from the page's activity state (lib/activity.js), so
// the town follows the same events as the rest of the page. Pure, no React, no three.js.
import { computeConflicts } from "../lib/conflicts.js";
import { matchGlob } from "../lib/zones.js";
import { roleOf } from "../lib/views.js";

export const CHARACTERS = ["hero", "mage", "priest"]; // by order of first appearance (spec 09)
export const ACTIVE_MS = 3 * 60_000; // an agent with no event for this long goes home (idle)
export const GONE_MS = 10 * 60_000; // ...and after this long it leaves the town (spec 09 §3.2)
export const RECENT_MS = 30 * 60_000; // a building written to within this window is "recent"
export const CONFLICT_SHOW_MS = 5000; // how long the sparks of a conflict show (spec 09 §3.2)
// A subagent lives for one job: this long after its last event it has handed back and leaves.
export const SUB_GONE_MS = 90_000;

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
    // a subagent's events carry its own id and its main agent's session (lib/normalize.mjs)
    const parent = ev.agent && ev.session && ev.session !== ev.agent ? ev.session : null;
    if (!e) out.set(key, (e = { latest: ev, parent, cast: null, search: null, stopOpen: ev.kind === "stop", wrote: false }));
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
 * - agents: [{ key, character, building, action, at, cast, search, cheer, parent }]. parent: for a
 *   subagent, its main agent's key (it takes that agent's character, spec 09 §3.1), else null.
 *   Only main agents count for the character order. action is write / read /
 *   blocked / cast (a shell command) / search / wait (stopped, waiting for the person) / idle. at is
 *   the agent's newest event (ms); cast: ms of its newest command; search: { at, buildings } of its
 *   newest search; cheer: ms of a Stop that ended a turn with writes. The renderer decides from these
 *   times how long each effect shows.
 * - recent: building ids written to within RECENT_MS.
 * - tests: { [building]: { outcome, at } }, the last test or build run shown on each building.
 * - conflicts: [{ building, at }], two agents writing the same file, newest first.
 * `agentSeq` numbers agents by first appearance (1-based); `buildingIds` are the pack's buildings;
 * `nowMs` the clock; `prompts`: agent key -> { at: ms } of its latest prompt (a prompt after a Stop
 * ends the wait); `warnings`: the page's scope warnings (lib/scope.js, Map key -> { rule, agent,
 * ts }) — each agent's `warnAt` is its newest write that looked out of place (conflicts have their
 * own sparks and do not count).
 */
export function townState(activity, agentSeq, buildingIds, nowMs, prompts = {}, warnings = null) {
  const warnAt = new Map();
  for (const w of warnings?.values?.() ?? []) {
    if (w.rule === "conflict") continue;
    const t = Date.parse(w.ts ?? "");
    if (!Number.isNaN(t) && t > (warnAt.get(w.agent) ?? 0)) warnAt.set(w.agent, t);
  }
  const evs = agentEvents(activity?.feed);
  const keys = new Set(Object.keys(activity?.agents ?? {}));
  for (const k of evs.keys()) keys.add(k);
  const agents = [];
  const where = new Map();
  // Characters follow the page's numbering (lib/sessions.js agentsIn), which numbers main agents
  // only: a subagent has its main agent's number. Without one, the order here stands in.
  const parentOf = (k) => evs.get(k)?.parent ?? null;
  const fallback = new Map([...keys].filter((k) => !parentOf(k)).map((k, i) => [k, i + 1]));
  const numberOf = (k) => agentSeq?.[k] ?? fallback.get(k) ?? 1;
  for (const key of keys) {
    const a = activity?.agents?.[key];
    if (a?.source === "watcher") continue; // changes no agent reported: no character (spec 09 §3.1)
    const e = evs.get(key);
    const building = buildingOf(a?.path, buildingIds) ?? "(root)";
    where.set(key, building);
    const at = Math.max(Date.parse(a?.ts ?? "") || 0, tsOf(e?.latest) ?? 0) || null;
    const parent = parentOf(key);
    if (at == null || nowMs - at > (parent ? SUB_GONE_MS : GONE_MS)) continue;
    let action = ACTIONS[a?.kind] ?? "idle";
    const latest = e?.latest;
    const prompted = (prompts?.[key]?.at ?? 0) > (tsOf(latest) ?? 0);
    if (latest?.kind === "stop") action = prompted ? "idle" : "wait";
    else if (latest?.kind === "search") action = "search";
    else if (latest && latest === e.cast) action = "cast";
    if (action !== "wait" && nowMs - at > ACTIVE_MS) action = "idle";
    const n = numberOf(parent ?? key);
    agents.push({
      key,
      parent,
      character: CHARACTERS[(n - 1) % CHARACTERS.length],
      building,
      action,
      at,
      cast: tsOf(e?.cast),
      search: e?.search ? { at: tsOf(e.search), buildings: searchedBuildings(e.search.paths?.[0], buildingIds) } : null,
      cheer: latest?.kind === "stop" && e.wrote ? tsOf(latest) : null,
      warnAt: warnAt.get(key) ?? null,
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
// The standing marks (spec 09 §4): the HOT_TOP buildings whose files were changed most in the
// churn window (at least HOT_MIN changes summed over their files) get the market stall; the
// PILLAR_TOP buildings used by the most files of other buildings (at least PILLAR_MIN) the flagpole.
// Ranked, not a fixed bar, so a small repo and a big one both show a few.
export const HOT_TOP = 3;
export const HOT_MIN = 10;
export const PILLAR_TOP = 3;
export const PILLAR_MIN = 5;

/** The `top` ids of `score` (Map id -> n) with n >= min, highest first. */
function topOf(score, top, min) {
  return new Set([...score].filter(([, n]) => n >= min).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, top).map(([id]) => id));
}

/**
 * What stands on each building without an agent there (spec 09 §4): { [building]: { changes,
 * level, added, deleted, big, locked, scope, warn, hot, pillar } }, only for buildings with
 * something to show. changes: files with uncommitted changes (`working`, the Map path -> change
 * from /api/working); added: of those, new files (status A, or R: a moved file lands as new) -> the
 * foundation and tent; deleted: status D -> the rubble; level 0-3 for the scaffold, from the
 * modified rest (none / 1-2 files / 3-9 / BIG_CHANGE or more); big: BIG_CHANGE or more changes of
 * any kind -> the crane; locked: the whole folder is in a locked zone (`locked` globs); scope: the
 * folder is inside the declared task scope (`allow` globs); warn: files written there that looked
 * out of place (`warnings`, lib/scope.js) and are not yet ticked off in the review (`reviewed`, a
 * Set of paths); hot: changes in the churn window (`churn`, path -> commits, /api/churn) when it
 * ranks among the hotspots, else 0; pillar: files of other buildings that use its files (`deps`,
 * lib/deps.js index) when it ranks among the most used, else 0.
 */
export function houseStates(buildingIds, { working = null, locked = [], allow = [], warnings = null, reviewed = null, churn = null, deps = null } = {}) {
  const out = {};
  const at = (id) => (out[id] ??= { changes: 0, level: 0, added: 0, deleted: 0, big: false, locked: false, scope: false, warn: 0, hot: 0, pillar: 0 });
  const warned = new Set();
  for (const w of warnings?.values?.() ?? []) if (w.rule !== "conflict" && !reviewed?.has(w.path)) warned.add(w.path);
  for (const p of warned) {
    const b = buildingOf(p, buildingIds);
    if (b) at(b).warn++;
  }
  for (const [p, c] of working?.entries?.() ?? []) {
    const b = buildingOf(p, buildingIds);
    if (!b) continue;
    const h = at(b);
    h.changes++;
    if (c?.status === "A" || c?.status === "R") h.added++;
    else if (c?.status === "D") h.deleted++;
  }
  // a folder counts as covered when a file directly in it would match
  const covered = (id, globs) => globs.some((g) => matchGlob(g, id === "(root)" ? "_" : `${id}/_`));
  for (const id of buildingIds) {
    if (locked.length && covered(id, locked)) at(id).locked = true;
    if (allow.length && covered(id, allow)) at(id).scope = true;
  }
  const heat = new Map();
  for (const [p, n] of Object.entries(churn ?? {})) {
    const b = buildingOf(p, buildingIds);
    if (b) heat.set(b, (heat.get(b) ?? 0) + n);
  }
  for (const id of topOf(heat, HOT_TOP, HOT_MIN)) at(id).hot = heat.get(id);
  const users = new Map(); // building -> Set of files elsewhere that use its files
  for (const [to, froms] of deps?.usedBy ?? []) {
    const b = buildingOf(to, buildingIds);
    if (!b) continue;
    for (const from of froms) {
      if (buildingOf(from, buildingIds) === b) continue;
      if (!users.has(b)) users.set(b, new Set());
      users.get(b).add(from);
    }
  }
  const used = new Map([...users].map(([b, s]) => [b, s.size]));
  for (const id of topOf(used, PILLAR_TOP, PILLAR_MIN)) at(id).pillar = used.get(id);
  for (const h of Object.values(out)) {
    const m = h.changes - h.added - h.deleted;
    h.level = m === 0 ? 0 : m < 3 ? 1 : m < BIG_CHANGE ? 2 : 3;
    h.big = h.changes >= BIG_CHANGE;
  }
  return out;
}

// Spec 09 §4: what shows when one building has several states. Higher comes first; at most
// MAX_SHOWN show as effects, the rest fold into chips on the sign. The locked barrier is not in
// this list: it always shows. New files and rubble are uncommitted work like the scaffold; the
// market stall and the flagpole stand for lasting traits and come last.
export const EFFECT_ORDER = ["blocked", "failed", "scaffold", "warn", "added", "deleted", "scope", "hot", "pillar"];
export const MAX_SHOWN = 2;

/** { show: kinds drawn as effects, folded: kinds shown as chips } for one building's `kinds`. */
export function prioritize(kinds) {
  const sorted = [...new Set(kinds)].filter((k) => EFFECT_ORDER.includes(k)).sort((a, b) => EFFECT_ORDER.indexOf(a) - EFFECT_ORDER.indexOf(b));
  return { show: sorted.slice(0, MAX_SHOWN), folded: sorted.slice(MAX_SHOWN) };
}

/**
 * What the map modes (spec 09 §5) need per building: { [id]: { role, touched, added, modified,
 * deleted } }. role: the role most of its files have (lib/views.js roleOf; "spec" counts as
 * "doc"); touched: "written" | "read" | null in `files` (the activity's files of the shown range);
 * added / modified / deleted: files in the compared branch's `diff` (Map path -> { status }).
 */
export function buildingModes(buildingIds, paths, { files = null, diff = null } = {}) {
  const out = Object.fromEntries(buildingIds.map((id) => [id, { role: null, touched: null, added: 0, modified: 0, deleted: 0 }]));
  const roles = new Map(); // id -> Map role -> count
  for (const p of paths ?? []) {
    const b = buildingOf(p, buildingIds);
    if (!b) continue;
    const r = roleOf(p) === "spec" ? "doc" : roleOf(p);
    if (!roles.has(b)) roles.set(b, new Map());
    roles.get(b).set(r, (roles.get(b).get(r) ?? 0) + 1);
  }
  for (const [b, m] of roles) out[b].role = [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  for (const [p, f] of Object.entries(files ?? {})) {
    const b = buildingOf(p, buildingIds);
    if (!b) continue;
    if (f.writes > 0 || f.blocked > 0) out[b].touched = "written";
    else if (f.reads > 0 && !out[b].touched) out[b].touched = "read";
  }
  for (const [p, c] of diff ?? []) {
    const b = buildingOf(p, buildingIds);
    if (!b) continue;
    if (c.status === "A") out[b].added++;
    else if (c.status === "D") out[b].deleted++;
    else out[b].modified++;
  }
  return out;
}
