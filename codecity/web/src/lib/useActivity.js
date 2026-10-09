import { useEffect, useRef, useState } from "react";
import { applyEvent, emptyActivity } from "./activity.js";

const FLUSH_MS = 100; // batch incoming events: at most one state update per window

/**
 * Subscribe to the live event stream (SSE) and fold every message through
 * applyEvent. Returns `{ activity, connected }`; `connected` is true after
 * onopen and false after onerror (the browser EventSource reconnects by itself).
 * Incoming events are collected and applied at most every 100 ms so the initial
 * replay of up to 200 events causes one render, not two hundred.
 *
 * `url` null = do not connect yet (the caller waits until it can resolve command paths).
 * `resolveCommand(command)` returns repo paths named in a shell command; they are attached to
 * exec events as `readPaths` so Bash reads light up buildings too.
 */
export function useActivity(url = "/api/events", resolveCommand = null) {
  const [activity, setActivity] = useState(emptyActivity);
  const [connected, setConnected] = useState(false);
  const resolveRef = useRef(resolveCommand);
  resolveRef.current = resolveCommand;

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return undefined; // not yet / non-browser

    let pending = [];
    let timer = null;

    const flush = () => {
      timer = null;
      if (!pending.length) return;
      const events = pending;
      pending = [];
      setActivity((prev) => events.reduce(applyEvent, prev));
    };

    const source = new EventSource(url);
    // The server replays its last 200 events on every (re)connect. Start from an empty state
    // each time so a reconnect does not double every count.
    source.onopen = () => {
      pending = [];
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

  return { activity, connected };
}
