// Splitting the event log into working sessions. The log keeps every event forever, so "this
// session" has to be decided here: a gap of GAP_MS without any event starts a new session.
// The city then shows one time range at a time — by default the latest session.

export const GAP_MS = 2 * 60 * 60 * 1000; // two quiet hours end a session

/**
 * Sessions of `events` (any order), oldest first:
 * [{ id, start, end, count, sources: [source...] }] with start/end in ms.
 * `id` is the start time, stable as long as the session's first event stays in the log.
 */
export function segmentSessions(events, gapMs = GAP_MS) {
  const times = [];
  for (const ev of events ?? []) {
    const t = Date.parse(ev?.ts ?? "");
    if (!Number.isNaN(t)) times.push([t, ev.source ?? "claude-code"]);
  }
  times.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = null;
  for (const [t, source] of times) {
    if (!cur || t - cur.end > gapMs) {
      cur = { id: t, start: t, end: t, count: 0, sources: new Set() };
      out.push(cur);
    }
    cur.end = t;
    cur.count++;
    cur.sources.add(source);
  }
  return out.map((s) => ({ ...s, sources: [...s.sources].sort() }));
}

/** Local midnight of the day containing `nowMs`. */
export function startOfDay(nowMs) {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The time range a selection stands for: { since, until } in ms, null meaning unbounded.
 * Selections: { kind: "recent" } (the latest session, still open), { kind: "today" },
 * { kind: "all" }, { kind: "session", id } (a past session, closed).
 * Before any event is known, "recent" shows nothing rather than flashing the whole log.
 */
export function rangeFor(selection, sessions, nowMs) {
  switch (selection?.kind) {
    case "all":
      return { since: null, until: null };
    case "today":
      return { since: startOfDay(nowMs), until: null };
    case "session": {
      const s = sessions.find((x) => x.id === selection.id);
      if (s && s !== sessions[sessions.length - 1]) return { since: s.start, until: s.end };
      // The newest session, or one that scrolled out of the log: same as "recent".
    }
    // falls through
    default: {
      const last = sessions[sessions.length - 1];
      return last ? { since: last.start, until: null } : { since: Infinity, until: null };
    }
  }
}

const agentKey = (ev) => ev?.agent ?? ev?.session ?? "unknown"; // same as activity.agentKeyOf

/**
 * Agents seen in `events` within the time part of `range`, numbered per source in order of first
 * appearance — the same "Claude 1, pi 1" numbering the feed uses, but fixed by the time range so
 * it does not change when the view is narrowed to one agent: [{ key, source, n, count }].
 * A subagent (its events carry the main agent's session) is not numbered on its own: it gets
 * { parent, n: the main agent's n, sub: 1, 2, ... in order of appearance }. When its main agent is
 * not in the range it is numbered like a main agent.
 */
export function agentsIn(events, range) {
  const timeOnly = range ? { since: range.since, until: range.until } : null;
  const seen = new Map();
  const parentOf = new Map();
  const sorted = (events ?? []).filter((ev) => inRange(ev, timeOnly)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const ev of sorted) {
    const key = agentKey(ev);
    if (!seen.has(key)) seen.set(key, { key, source: ev.source ?? "claude-code", count: 0 });
    seen.get(key).count++;
    if (ev.agent && ev.session && ev.session !== ev.agent && !parentOf.has(key)) parentOf.set(key, ev.session);
  }
  const perSource = new Map();
  const subs = new Map();
  const out = [];
  for (const a of seen.values()) {
    const parent = parentOf.get(a.key);
    const main = parent ? seen.get(parent) : null;
    if (main) {
      const k = (subs.get(parent) ?? 0) + 1;
      subs.set(parent, k);
      out.push({ ...a, parent, sub: k }); // n filled in below: the main agent may come later
    } else {
      const n = (perSource.get(a.source) ?? 0) + 1;
      perSource.set(a.source, n);
      out.push({ key: a.key, source: a.source, n, count: a.count });
    }
  }
  const nOf = new Map(out.filter((a) => !a.parent).map((a) => [a.key, a.n]));
  return out.map((a) => (a.parent ? { key: a.key, source: a.source, n: nOf.get(a.parent), count: a.count, parent: a.parent, sub: a.sub } : a));
}

/**
 * Display names for agentsIn() rows: "Claude 1", "pi 2", "檔案監看"; a subagent is named after its
 * main agent ("Claude 1 的跟班"). `tr` is i18n's t. { [key]: name }.
 */
export function agentLabels(agents, tr) {
  const base = (a) => {
    if (a.source === "watcher") return tr("source.watcher");
    const name = tr(`source.${a.source}`);
    return `${name.startsWith("source.") ? a.source : name} ${a.n}`;
  };
  return Object.fromEntries((agents ?? []).map((a) => [a.key, a.parent ? tr("agent.helper", { name: base(a) }) : base(a)]));
}

/**
 * Whether an event falls inside a range from rangeFor; `range.agent`, when set, also limits it to
 * one agent's events.
 */
export function inRange(ev, range) {
  if (!range) return true;
  if (range.agent != null && agentKey(ev) !== range.agent) return false;
  const t = Date.parse(ev?.ts ?? "");
  if (Number.isNaN(t)) return range.since == null; // undated events only in unbounded views
  return (range.since == null || t >= range.since) && (range.until == null || t <= range.until);
}
