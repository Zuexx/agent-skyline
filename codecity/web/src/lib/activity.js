// Pure state for live Claude Code activity: per-file counts/timestamps, the
// last-known position of each agent, and a capped feed of recent events.
// No React here — see useActivity.js for the hook that folds SSE messages in.

import { t } from "./i18n.js";

// The whole working session stays scrollable in the feed; the oldest entries drop off past this.
export const FEED_MAX = 1000;
const BLOCKED_WINDOW_MS = 3000;
const READ_WINDOW_MS = 4000;
const TINT_KINDS = ["read", "write", "blocked"];

const FEED_ONLY_KINDS = ["exec", "search"]; // shown in the feed, but name no building

export function emptyActivity() {
  // agentSeq numbers agents in order of first appearance, for readable "Agent 1" labels.
  return { files: {}, agents: {}, feed: [], agentSeq: {}, agentSource: {} };
}

function sameFeedItem(a, b) {
  return (
    a &&
    agentKeyOf(a) === agentKeyOf(b) &&
    a.kind === b.kind &&
    (a.paths?.[0] ?? null) === (b.paths?.[0] ?? null) &&
    (a.detail ?? null) === (b.detail ?? null)
  );
}

// Newest first, capped. A repeat of the newest entry (same agent, kind, path, command) bumps its
// `repeat` count instead of adding a row, so ten reads of one file stay one readable line.
function pushFeed(feed, ev) {
  if (sameFeedItem(feed[0], ev)) return [{ ...ev, repeat: (feed[0].repeat ?? 1) + 1 }, ...feed.slice(1)];
  return [ev, ...feed].slice(0, FEED_MAX);
}

// Agents are numbered per source in order of first appearance: Claude 1, Claude 2, pi 1, ...
// agentSeq: { [agentKey]: n }, agentSource: { [agentKey]: source }.
function withAgent(state, ev) {
  const key = agentKeyOf(ev);
  const seq = state.agentSeq ?? {};
  if (key in seq) return { agentSeq: seq, agentSource: state.agentSource ?? {} };
  const source = sourceOf(ev);
  const sources = state.agentSource ?? {};
  const n = Object.keys(seq).filter((k) => sources[k] === source).length + 1;
  return { agentSeq: { ...seq, [key]: n }, agentSource: { ...sources, [key]: source } };
}

/** Which tool produced an event. Events logged before sources existed came from Claude Code. */
export function sourceOf(ev) {
  return ev?.source ?? "claude-code";
}

/** 1-based number of an agent in order of first appearance (0 if never seen). */
export function agentNumber(state, key) {
  return state.agentSeq?.[key] ?? 0;
}

/** ev.agent ?? ev.session ?? "unknown" — the key an agent is tracked under. */
export function agentKeyOf(ev) {
  return ev?.agent ?? ev?.session ?? "unknown";
}

/**
 * Fold one event into the activity state, returning a NEW state (the input is
 * never mutated). Events whose kind is not read/write/blocked, or that carry
 * no paths, are ignored and yield the same state object back.
 */
export function applyEvent(state, ev) {
  if (!ev) return state;
  const who = withAgent(state, ev);
  // Commands and searches: feed only. Claude often reads code through Bash, and an empty feed
  // while it works would look broken.
  if (FEED_ONLY_KINDS.includes(ev.kind)) {
    const next = { ...state, feed: pushFeed(state.feed, ev), ...who };
    // Files the command named (resolved by the caller, see commandPaths.js) count as reads.
    const readPaths = (ev.readPaths ?? []).filter((p) => typeof p === "string" && p.length > 0);
    if (!readPaths.length) return next;
    const files = { ...state.files };
    for (const p of readPaths) {
      const f = files[p] ?? { reads: 0, writes: 0, blocked: 0, lastRead: null, lastWrite: null, lastBlocked: null };
      files[p] = { ...f, reads: f.reads + 1, lastRead: ev.ts ?? null };
    }
    const agents = {
      ...state.agents,
      [agentKeyOf(ev)]: { path: readPaths[readPaths.length - 1], ts: ev.ts ?? null, kind: "read", source: sourceOf(ev) },
    };
    return { ...next, files, agents };
  }
  if (!TINT_KINDS.includes(ev.kind)) return state;
  const paths = Array.isArray(ev.paths) ? ev.paths.filter((p) => typeof p === "string" && p.length > 0) : [];
  if (!paths.length) return state;

  const files = { ...state.files };
  for (const path of paths) {
    const f = files[path] ?? { reads: 0, writes: 0, blocked: 0, lastRead: null, lastWrite: null, lastBlocked: null };
    if (ev.kind === "read") files[path] = { ...f, reads: f.reads + 1, lastRead: ev.ts ?? null };
    else if (ev.kind === "write") files[path] = { ...f, writes: f.writes + 1, lastWrite: ev.ts ?? null };
    else files[path] = { ...f, blocked: f.blocked + 1, lastBlocked: ev.ts ?? null };
  }

  const agents = {
    ...state.agents,
    [agentKeyOf(ev)]: { path: paths[paths.length - 1], ts: ev.ts ?? null, kind: ev.kind, source: sourceOf(ev) },
  };
  const feed = pushFeed(state.feed, ev);

  return { files, agents, feed, ...who };
}

/** "剛剛" / "12 秒前" / "3 分鐘前" / "2 小時前" — relative age for the feed. */
export function formatAgo(ts, nowMs) {
  const then = Date.parse(ts ?? "");
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((nowMs - then) / 1000));
  if (s < 5) return t("ago.now");
  if (s < 60) return t("ago.s", { n: s });
  if (s < 3600) return t("ago.m", { n: Math.floor(s / 60) });
  return t("ago.h", { n: Math.floor(s / 3600) });
}

/** Split "a/b/c.ts" into { name: "c.ts", dir: "a/b" }. */
export function splitPath(p) {
  const s = String(p ?? "");
  const i = s.lastIndexOf("/");
  return i < 0 ? { name: s, dir: "" } : { name: s.slice(i + 1), dir: s.slice(0, i) };
}

/** Stable index in [0, n) for an agent key (FNV-1a string hash). */
export function agentColorIndex(agentKey, n) {
  if (!n || n <= 0) return 0;
  const key = String(agentKey ?? "unknown");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % n;
}

function withinWindow(isoTs, nowMs, windowMs) {
  if (!isoTs) return false;
  const t = Date.parse(isoTs);
  if (Number.isNaN(t)) return false;
  return Math.abs(nowMs - t) <= windowMs;
}

/**
 * Live tint for a building: "blocked" if blocked within the last 3000 ms,
 * else "read" if read within the last 4000 ms, else "written" once it has
 * been written at all, else null.
 */
export function buildingTint(fileActivity, nowMs) {
  if (!fileActivity) return null;
  if (withinWindow(fileActivity.lastBlocked, nowMs, BLOCKED_WINDOW_MS)) return "blocked";
  if (withinWindow(fileActivity.lastRead, nowMs, READ_WINDOW_MS)) return "read";
  if ((fileActivity.writes ?? 0) > 0) return "written";
  return null;
}

/** ISO timestamp -> local "HH:MM:SS", or "" when missing/unparseable. */
export function formatClock(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (v) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
