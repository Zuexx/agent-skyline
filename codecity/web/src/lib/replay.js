// Timeline replay. The city's live effects (read flashes, pulses, agent markers, fading) all
// measure age against the wall clock. To replay the session as of time T, take the events up to T
// and shift their timestamps by (now - T): T then looks like "just now", and every effect works
// unchanged — including pulses firing as playback crosses each event.
import { applyEvent, emptyActivity } from "./activity.js";

/** [firstMs, lastMs] of a newest-first feed, or null when empty. */
export function feedRange(feed) {
  if (!feed?.length) return null;
  const last = Date.parse(feed[0].ts);
  const first = Date.parse(feed[feed.length - 1].ts);
  return Number.isNaN(first) || Number.isNaN(last) ? null : [first, last];
}

/** Activity as it stood at `atMs`, with timestamps shifted so that `atMs` reads as `nowMs`. */
export function activityAt(feed, atMs, nowMs) {
  const shift = nowMs - atMs;
  let state = emptyActivity();
  for (let i = (feed?.length ?? 0) - 1; i >= 0; i--) {
    const ev = feed[i];
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t) || t > atMs) continue;
    // Collapsed rows (repeat > 1) replay as a single event at their last time; good enough to
    // see where the agent was, and the counts in the live view stay exact.
    state = applyEvent(state, { ...ev, ts: new Date(t + shift).toISOString(), repeat: undefined });
  }
  return state;
}

/** Event marks for the timeline track: [{ at: 0..1, kind }], writes and blocks only. */
export function timelineMarks(feed, range) {
  if (!range) return [];
  const [a, b] = range;
  const span = Math.max(1, b - a);
  const out = [];
  for (const ev of feed ?? []) {
    if (ev.kind !== "write" && ev.kind !== "blocked") continue;
    const t = Date.parse(ev.ts);
    if (!Number.isNaN(t)) out.push({ at: (t - a) / span, kind: ev.kind });
  }
  return out;
}
