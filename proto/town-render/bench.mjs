// Renderer comparison bench (specs/08): runs the web and the Godot town on the same pack, view and
// size, uncapped (no vsync), and reports fps, load time and memory of each.
//   node proto/town-render/bench.mjs --pack <dir> --godot <godot exe> [--seconds 10] [--only web|godot]
// Needs state.mjs running on 4478 (use --demo-fixed so both see the same agents).
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const pack = path.resolve(arg("--pack", "docs/concept/town_poc/pack_v4"));
const godot = arg("--godot", "D:/GODOT/Godot_v4.7.2-stable_win64_console.exe");
const seconds = Number(arg("--seconds", 10));
const only = arg("--only", null);
const vsync = args.includes("--vsync"); // capped at the display rate: smoothness, not headroom
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-z]:)/i, "$1"));
const CASES = [
  { variant: "night", view: "pano", size: [1920, 960] },
  { variant: "night", view: "close", size: [1920, 1080] },
  { variant: "day", view: "pano", size: [1920, 960] },
  { variant: "night", view: "pano", size: [3840, 1920] },
];

function measure(match) {
  try {
    // run as a command (script files may be blocked by the execution policy)
    const script = fs.readFileSync(path.join(here, "measure.ps1"), "utf8").replace(/^param\(.*\)$/m, `$Match = '${match.replace(/'/g, "''")}'`);
    return JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

async function web(c) {
  const { chromium } = await import("file:///D:/Labs/agent-projects/agent-skyline/demo/node_modules/playwright-core/index.mjs");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "townbench-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    viewport: { width: c.size[0], height: c.size[1] },
    args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-precise-memory-info", ...(vsync ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"])],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:4478/?variant=${c.variant}&view=${c.view}&bench=${seconds}&hud=0&size=${c.size.join("x")}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const firstFrameS = (Date.now() - t0) / 1000;
  await page.waitForTimeout(2000 + (seconds * 1000) / 2);
  const mem = measure(path.basename(profile));
  const r = await page.waitForFunction(() => window.__bench, null, { timeout: (seconds + 30) * 1000 }).then((h) => h.jsonValue());
  await ctx.close();
  return { ...r, until_ready_s: firstFrameS, ...mem };
}

async function electronRun(c) {
  const dir = path.join(here, "electron");
  const exe = path.join(dir, "node_modules", "electron", "dist", "electron.exe");
  const t0 = Date.now();
  const url = `http://127.0.0.1:4478/?variant=${c.variant}&view=${c.view}&bench=${seconds}&hud=0&size=${c.size.join("x")}`;
  const p = spawn(exe, [dir, `--url=${url}`, `--size=${c.size.join("x")}`, "--bench", ...(vsync ? [] : ["--uncapped"])], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  await new Promise((r) => setTimeout(r, 4000 + 2000 + (seconds * 1000) / 2));
  const mem = measure(path.join("electron", "node_modules", "electron"));
  await new Promise((r) => p.on("exit", r));
  const line = out.split("\n").find((l) => l.startsWith("BENCH "));
  const r = line ? JSON.parse(line.slice(6)) : { error: out.slice(-500) };
  return { ...r, wall_s: (Date.now() - t0) / 1000, ...mem };
}

async function godotRun(c) {
  const proj = path.join(here, "godot");
  const t0 = Date.now();
  const p = spawn(godot, ["--path", proj, "--", `--pack=${pack}`, `--variant=${c.variant}`, `--view=${c.view}`, `--size=${c.size.join("x")}`, `--bench=${seconds}`, ...(vsync ? ["--vsync"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  await new Promise((r) => setTimeout(r, 2000 + 2000 + (seconds * 1000) / 2));
  const mem = measure("town-render" + path.sep + "godot");
  const memAlt = mem.processes ? mem : measure("town-render/godot");
  await new Promise((r) => p.on("exit", r));
  const line = out.split("\n").find((l) => l.startsWith("BENCH "));
  const r = line ? JSON.parse(line.slice(6)) : { error: out.slice(-500) };
  return { ...r, wall_s: (Date.now() - t0) / 1000, ...memAlt };
}

const results = [];
for (const c of CASES) {
  for (const engine of ["web", "electron", "godot"]) {
    if (only && !only.split(",").includes(engine)) continue;
    const r = engine === "web" ? await web(c) : engine === "electron" ? await electronRun(c) : await godotRun(c);
    const row = { engine, ...c, size: c.size.join("x"), ...r };
    console.log(JSON.stringify(row));
    results.push(row);
  }
}
fs.writeFileSync(path.join(here, vsync ? "bench-results-vsync.json" : "bench-results.json"), JSON.stringify(results, null, 1));
