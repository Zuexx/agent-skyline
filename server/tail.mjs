// Follow a JSONL event log by polling fs.stat every intervalMs. We deliberately do not use
// fs.watch: it is unreliable on Windows, the platform the hooks that write this log run on.
// Only complete lines are emitted (a partial trailing line stays buffered until its \n
// arrives), lines that are not valid JSON objects are skipped, a missing file is waited for,
// and a shrink (truncation) restarts reading from byte 0.

import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export function tailJsonl(file, { fromStart = false, onEvent, intervalMs = 300 }) {
  // pos is the number of bytes already consumed; -1 means "not yet positioned".
  let pos = -1;
  let pending = "";
  // Keeps a multi-byte UTF-8 character that straddles two reads intact (non-ASCII paths).
  let decoder = new StringDecoder("utf8");
  let busy = false;
  let closed = false;

  function emit(line) {
    const text = line.trim();
    if (text === "") return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return; // not valid JSON -> skip the line
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) return;
    if (typeof onEvent === "function") {
      try {
        onEvent(event);
      } catch {
        // A throwing consumer must not corrupt the tailer's position or buffer.
      }
    }
  }

  async function tick() {
    if (closed || busy) return;
    busy = true;
    try {
      let size;
      try {
        size = (await stat(file)).size;
      } catch (err) {
        // Missing at the first poll: everything written once it appears is new, so read
        // it from byte 0 instead of skipping to its end.
        if (err && err.code === "ENOENT" && pos === -1) pos = 0;
        throw err;
      }
      if (pos === -1) pos = fromStart ? 0 : size; // first sighting: end of file unless fromStart
      if (size < pos) {
        pos = 0; // truncated -> restart from the beginning
        pending = "";
        decoder = new StringDecoder("utf8");
      }
      if (size > pos) {
        const handle = await open(file, "r");
        try {
          const buffer = Buffer.alloc(size - pos);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, pos);
          pos += bytesRead; // may be less than requested if the file shrank mid-read
          pending += decoder.write(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      }
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        emit(line);
      }
    } catch {
      // Missing file or transient error (e.g. a briefly locked file on Windows): wait for the next tick.
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  void tick(); // first poll immediately so callers do not wait a full interval

  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
    },
  };
}
