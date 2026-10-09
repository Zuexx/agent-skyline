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

/** Whether an event falls inside a range from rangeFor. */
export function inRange(ev, range) {
  if (!range) return true;
  const t = Date.parse(ev?.ts ?? "");
  if (Number.isNaN(t)) return range.since == null; // undated events only in unbounded views
  return (range.since == null || t >= range.since) && (range.until == null || t <= range.until);
}
