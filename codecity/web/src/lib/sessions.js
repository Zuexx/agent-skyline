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
 */
export function agentsIn(events, range) {
  const timeOnly = range ? { since: range.since, until: range.until } : null;
  const seen = new Map();
  const perSource = new Map();
  const sorted = (events ?? []).filter((ev) => inRange(ev, timeOnly)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const ev of sorted) {
    const key = agentKey(ev);
    const source = ev.source ?? "claude-code";
    if (!seen.has(key)) {
      const n = (perSource.get(source) ?? 0) + 1;
      perSource.set(source, n);
      seen.set(key, { key, source, n, count: 0 });
    }
    seen.get(key).count++;
  }
  return [...seen.values()];
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
