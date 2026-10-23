import { describe, expect, it } from "vitest";
import { buildTasks, latestByAgent, summarize, taskState, IDLE_MS } from "./tasks.js";

const T0 = Date.parse("2026-10-23T08:00:00.000Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const ev = (s, kind, extra = {}) => ({ ts: at(s), session: "s1", agent: null, kind, paths: [], detail: null, ...extra });

describe("buildTasks", () => {
  it("walks a task through every stage, from prompt to stop", () => {
    const [task] = buildTasks([
      ev(0, "prompt", { detail: "Fix the login bug" }),
      ev(5, "read", { paths: ["api/login.ts"] }),
      ev(9, "write", { paths: ["api/login.ts"] }),
      ev(12, "exec", { check: true, outcome: "passed", detail: "npm test" }),
      ev(20, "stop"),
    ]);
    expect(task.prompt).toBe("Fix the login bug");
    expect(task.stage).toBe("done");
    expect(task.reached).toEqual({ asked: T0, exploring: T0 + 5000, changing: T0 + 9000, checking: T0 + 12000, done: T0 + 20000 });
    expect([...task.writes]).toEqual(["api/login.ts"]);
    expect(task.checks).toEqual([{ ts: T0 + 12000, outcome: "passed", command: "npm test" }]);
    expect(task.end).toBe(T0 + 20000);
  });

  it("goes back to changing when the agent writes after a check, keeping when checking was first reached", () => {
    const [task] = buildTasks([ev(0, "prompt"), ev(1, "write", { paths: ["a"] }), ev(2, "exec", { check: true, outcome: "failed" }), ev(3, "write", { paths: ["a"] })]);
    expect(task.stage).toBe("changing");
    expect(task.reached.checking).toBe(T0 + 2000);
  });

  it("starts a task at the first event when no prompt was logged, and a new prompt ends the old task", () => {
    const tasks = buildTasks([ev(0, "read", { paths: ["x"] }), ev(10, "prompt", { detail: "next" }), ev(11, "search")]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ prompt: null, stage: "exploring", end: T0 });
    expect(tasks[1]).toMatchObject({ prompt: "next", stage: "exploring", end: null });
  });

  it("keeps agents apart, records blocks, and ignores the watcher", () => {
    const tasks = buildTasks([
      ev(0, "write", { paths: ["a"] }),
      ev(1, "blocked", { agent: "sub1", paths: ["locked/x"], detail: "in locked zone" }),
      ev(2, "write", { paths: ["b"], source: "watcher" }),
    ]);
    expect(tasks.map((t) => t.agent)).toEqual(["s1", "sub1"]);
    expect(tasks[1].blocked).toEqual([{ ts: T0 + 1000, path: "locked/x", reason: "in locked zone" }]);
    expect([...tasks[0].writes]).toEqual(["a"]);
  });

  it("sorts events by time and skips undated ones", () => {
    const tasks = buildTasks([ev(5, "stop"), ev(0, "prompt"), { kind: "read", paths: ["z"] }]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].stage).toBe("done");
  });
});

describe("taskState and summarize", () => {
  it("tells working, idle and done apart", () => {
    const [open] = buildTasks([ev(0, "read", { paths: ["x"] })]);
    expect(taskState(open, T0 + 1000)).toBe("working");
    expect(taskState(open, T0 + IDLE_MS + 1)).toBe("idle");
    const [done] = buildTasks([ev(0, "prompt"), ev(1, "stop")]);
    expect(taskState(done, T0 + 2000)).toBe("done");
  });

  it("counts active agents, written files, blocks, out-of-scope writes and the last check", () => {
    const tasks = buildTasks([
      ev(0, "write", { paths: ["api/a"] }),
      ev(1, "write", { paths: ["web/b"], agent: "sub" }),
      ev(2, "blocked", { paths: ["secret/c"], agent: "sub" }),
      ev(3, "exec", { check: true, outcome: "failed", detail: "npm test" }),
      ev(4, "exec", { check: true, outcome: "passed", detail: "npm test", agent: "sub" }),
      ev(5, "stop"),
    ]);
    expect(latestByAgent(tasks).size).toBe(2);
    const s = summarize(tasks, T0 + 6000, (p) => !p.startsWith("api/"));
    expect(s).toEqual({ active: 1, written: 2, blocked: 1, outOfScope: 1, lastCheck: { ts: T0 + 4000, outcome: "passed", command: "npm test" } });
    expect(summarize([], T0).lastCheck).toBeNull();
  });
});
