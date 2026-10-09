import { useEffect, useRef, useState } from "react";
import { applyEvent, emptyActivity } from "./activity.js";
import { inRange } from "./sessions.js";

const FLUSH_MS = 100; // batch incoming events: at most one state update per window
const RAW_MAX = 20000; // raw events kept for re-filtering (the server replays up to 5,000)

/**
 * Subscribe to the live event stream (SSE). Every event is kept raw; the ones inside `range`
 * ({ since, until } in ms, see sessions.js) are folded through applyEvent into `activity`.
 * Changing the range re-folds the kept events, so the city can show one working session at a
 * time while the log keeps everything.
 *
 * Returns { activity, connected, events, version, writes }:
 * - `events`: every raw event received since the last (re)connect, in arrival order;
 * - `version`: bumps whenever `events` grows (for memos over `events`);
 * - `writes`: number of write events received, in or out of range.
 * Incoming events are applied at most every 100 ms, so the initial replay renders once.
 *
 * `url` null = do not connect yet (the caller waits until it can resolve command paths).
 * `resolveCommand(command)` returns repo paths named in a shell command; they are attached to
 * exec events as `readPaths` so Bash reads light up buildings too.
 */
export function useActivity(url = "/api/events", resolveCommand = null, range = null) {
  const [activity, setActivity] = useState(emptyActivity);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const raw = useRef([]);
  const writes = useRef(0);
  const resolveRef = useRef(resolveCommand);
  resolveRef.current = resolveCommand;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return undefined; // not yet / non-browser

    let pending = [];
    let timer = null;

    const flush = () => {
      timer = null;
      if (!pending.length) return;
      const events = pending;
      pending = [];
      raw.current.push(...events);
      if (raw.current.length > RAW_MAX) raw.current = raw.current.slice(-RAW_MAX);
      writes.current += events.filter((ev) => ev.kind === "write").length;
      const shown = events.filter((ev) => inRange(ev, rangeRef.current));
      if (shown.length) setActivity((prev) => shown.reduce(applyEvent, prev));
      setVersion((v) => v + 1);
    };

    const source = new EventSource(url);
    // The server replays its recent history on every (re)connect. Start from an empty state
    // each time so a reconnect does not double every count.
    source.onopen = () => {
      pending = [];
      raw.current = [];
      writes.current = 0;
      setActivity(emptyActivity());
      setConnected(true);
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      let ev;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return; // ignore malformed frames
      }
      if (ev && ev.kind === "exec" && resolveRef.current) ev = { ...ev, readPaths: resolveRef.current(ev.detail) };
      pending.push(ev);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [url]);

  // A new range: rebuild the state from the kept events.
  const since = range?.since ?? null;
  const until = range?.until ?? null;
  useEffect(() => {
    setActivity(raw.current.filter((ev) => inRange(ev, { since, until })).reduce(applyEvent, emptyActivity()));
  }, [since, until]);

  return { activity, connected, events: raw.current, version, writes: writes.current };
}
