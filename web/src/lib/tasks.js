// Tasks and their stages, from the event log — the agent's version of WareTrack's shipment tracker.
// A task is one turn of one agent: it starts when the person gives a prompt (UserPromptSubmit,
// kind "prompt") and ends at the agent's Stop. Agents that log no prompts (pi, subagents, logs from
// before prompts were recorded) start a task at their first event. Pure, no React.

import { agentKeyOf, sourceOf } from "./activity.js";

export const STAGES = ["asked", "exploring", "changing", "checking", "done"];

const EXPLORE_KINDS = new Set(["read", "search", "exec"]);

function newTask(ev, key, t) {
  return {
    id: `${key}@${ev.ts}`,
    agent: key,
    source: sourceOf(ev),
    prompt: ev.kind === "prompt" ? ev.detail ?? null : null,
    start: t,
    end: null,
    lastTs: t,
    stage: "asked",
    reached: { asked: t },
    reads: new Set(),
    writes: new Set(),
    blocked: [], // [{ ts, path, reason }]
    checks: [], // [{ ts, outcome: "passed" | "failed" | null, command }]
    lastPath: null,
  };
}

function reach(task, stage, t) {
  task.stage = stage;
  if (task.reached[stage] == null) task.reached[stage] = t;
}

/**
 * Every task in `events` (any order), oldest first. Watcher events have no author and start no
 * task. Each task: { id, agent, source, prompt, start, end, lastTs, stage, reached: { [stage]: ms },
 * reads: Set, writes: Set, blocked: [...], checks: [...], lastPath }.
 */
export function buildTasks(events) {
  const sorted = (events ?? [])
    .map((ev) => [Date.parse(ev?.ts ?? ""), ev])
    .filter(([t, ev]) => !Number.isNaN(t) && sourceOf(ev) !== "watcher")
    .sort((a, b) => a[0] - b[0]);
  const all = [];
  const open = new Map(); // agent key -> its open task
  for (const [t, ev] of sorted) {
    const key = agentKeyOf(ev);
    let task = open.get(key);
    if (ev.kind === "prompt") {
      if (task) task.end = task.lastTs; // a new prompt before Stop: the old task just ends there
      task = newTask(ev, key, t);
      open.set(key, task);
      all.push(task);
      continue;
    }
    if (ev.kind === "stop") {
      if (!task) continue;
      reach(task, "done", t);
      task.end = t;
      task.lastTs = t;
      open.delete(key);
      continue;
    }
    if (!EXPLORE_KINDS.has(ev.kind) && ev.kind !== "write" && ev.kind !== "blocked") continue;
    if (!task) {
      task = newTask(ev, key, t);
      open.set(key, task);
      all.push(task);
    }
    task.lastTs = t;
    const path = ev.paths?.[0] ?? null;
    // Only repo paths name a building; a file outside the repo stays absolute.
    if (path && !path.startsWith("/") && !/^[a-z]:\//i.test(path)) task.lastPath = path;
    if (ev.kind === "write") {
      for (const p of ev.paths ?? []) task.writes.add(p);
      reach(task, "changing", t); // also after checking: the agent went back to fix something
    } else if (ev.kind === "blocked") {
      task.blocked.push({ ts: t, path, reason: ev.detail ?? null });
    } else if (ev.kind === "exec" && ev.check) {
      task.checks.push({ ts: t, outcome: ev.outcome ?? null, command: ev.detail ?? null });
      reach(task, "checking", t);
    } else {
      if (ev.kind === "read") for (const p of ev.paths ?? []) task.reads.add(p);
      if (task.stage === "asked") reach(task, "exploring", t);
    }
  }
  return all;
}

export const IDLE_MS = 10 * 60 * 1000; // an open task with no event for this long is idle

/** "working" | "idle" | "done" for a task at `nowMs`. */
export function taskState(task, nowMs) {
  if (task.end != null) return "done";
  return nowMs - task.lastTs > IDLE_MS ? "idle" : "working";
}

/** The newest task of each agent: Map agent key -> task. */
export function latestByAgent(tasks) {
  const out = new Map();
  for (const task of tasks) out.set(task.agent, task); // tasks are oldest first
  return out;
}

/**
 * The KPI cards' numbers over `tasks`:
 * { active, written, blocked, outOfScope, lastCheck: { outcome, ts, command } | null }.
 * `outOfScope(path)` says whether a written path lies outside the declared scope (null: no scope).
 */
export function summarize(tasks, nowMs, outOfScope = null) {
  const written = new Set();
  const stray = new Set();
  let blocked = 0;
  let lastCheck = null;
  let active = 0;
  for (const task of latestByAgent(tasks).values()) if (taskState(task, nowMs) === "working") active++;
  for (const task of tasks) {
    for (const p of task.writes) {
      written.add(p);
      if (outOfScope?.(p)) stray.add(p);
    }
    blocked += task.blocked.length;
    const c = task.checks[task.checks.length - 1];
    if (c && (!lastCheck || c.ts > lastCheck.ts)) lastCheck = c;
  }
  return { active, written: written.size, blocked, outOfScope: stray.size, lastCheck };
}
