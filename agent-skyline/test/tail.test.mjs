import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tailJsonl } from "../server/tail.mjs";

const INTERVAL = 15; // ms between polls in these tests

async function withTempDir(t, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-tail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return fn(dir);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll until fn() is truthy or the timeout elapses; throws on timeout so a stuck tail fails loudly.
async function waitFor(fn, what, timeoutMs = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

test("tailJsonl with fromStart emits existing lines and skips invalid ones", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl");
    // One valid object, one non-JSON line, one JSON array (not an object), one more valid object.
    await writeFile(file, '{"a":1}\nnot json\n[1,2]\n{"b":2}\n');
    const events = [];
    const tail = tailJsonl(file, { fromStart: true, onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await waitFor(() => events.length === 2, "both valid lines");
    assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
  });
});

test("tailJsonl without fromStart starts at the end and picks up appended lines", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl");
    await writeFile(file, '{"old":true}\n');
    const events = [];
    const tail = tailJsonl(file, { onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    // Give the first poll time to position at the current end before appending.
    await sleep(INTERVAL * 3);
    assert.deepEqual(events, []);
    await appendFile(file, '{"new":true}\n');

    await waitFor(() => events.length === 1, "the appended line");
    assert.deepEqual(events, [{ new: true }]); // the pre-existing line was not replayed
  });
});

test("tailJsonl waits for a missing file to appear", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl"); // does not exist yet
    const events = [];
    const tail = tailJsonl(file, { fromStart: true, onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await sleep(INTERVAL * 3);
    assert.deepEqual(events, []); // no crash while the file is absent
    await writeFile(file, '{"appeared":true}\n');

    await waitFor(() => events.length === 1, "the line in the newly created file");
    assert.deepEqual(events, [{ appeared: true }]);
  });
});

test("tailJsonl buffers a partial trailing line until its newline arrives", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl");
    await writeFile(file, '{"partial":'); // no \n yet
    const events = [];
    const tail = tailJsonl(file, { fromStart: true, onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await sleep(INTERVAL * 4);
    assert.deepEqual(events, []); // incomplete line must not be emitted
    await appendFile(file, 'true}\n');

    await waitFor(() => events.length === 1, "the completed line");
    assert.deepEqual(events, [{ partial: true }]);
  });
});

test("tailJsonl restarts from the beginning when the file is truncated", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl");
    await writeFile(file, '{"a":1}\n{"c":3}\n'); // 16 bytes
    const events = [];
    const tail = tailJsonl(file, { fromStart: true, onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await waitFor(() => events.length === 2, "both initial lines");
    // Overwrite with a shorter file: the size drop must trigger a restart from byte 0.
    await writeFile(file, '{"d":4}\n'); // 8 bytes < 16

    await waitFor(() => events.length === 3, "the line after truncation");
    assert.deepEqual(events, [{ a: 1 }, { c: 3 }, { d: 4 }]);
  });
});

test("tailJsonl without fromStart reads a file created after start from its beginning", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl"); // the hook has not created it yet
    const events = [];
    const tail = tailJsonl(file, { onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await sleep(INTERVAL * 3);
    await writeFile(file, '{"first":true}\n');

    await waitFor(() => events.length === 1, "the first event in the new file");
    assert.deepEqual(events, [{ first: true }]);
  });
});

test("tailJsonl keeps a multi-byte character split across two reads intact", async (t) => {
  await withTempDir(t, async (dir) => {
    const file = path.join(dir, "events.jsonl");
    const bytes = Buffer.from('{"path":"文件/設計.md"}\n', "utf8");
    const cut = bytes.indexOf(Buffer.from("文", "utf8")) + 1; // inside the 3-byte character
    await writeFile(file, bytes.subarray(0, cut));
    const events = [];
    const tail = tailJsonl(file, { fromStart: true, onEvent: (e) => events.push(e), intervalMs: INTERVAL });
    t.after(tail.close);

    await sleep(INTERVAL * 4);
    await appendFile(file, bytes.subarray(cut));

    await waitFor(() => events.length === 1, "the completed line");
    assert.deepEqual(events, [{ path: "文件/設計.md" }]);
  });
});
