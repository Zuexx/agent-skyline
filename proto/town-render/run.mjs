// Try a town renderer as a desktop window, live on the running Agent Skyline (4477).
//   node proto/town-render/run.mjs godot|electron [--night|--day] [--close] [--on-top] [--opacity=0.85] [--frameless] [--demo]
// Starts the state bridge (4478) if it is not running yet; it keeps running after the window closes.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-z]:)/i, "$1"));
const root = path.resolve(here, "../..");
const pack = path.join(root, "docs/concept/town_poc/pack_v4");
const godot = process.env.GODOT ?? "D:/GODOT/Godot_v4.7.2-stable_win64_console.exe";
const [engine = "godot", ...rest] = process.argv.slice(2);
const has = (f) => rest.includes(f);
const val = (f) => rest.find((a) => a.startsWith(f + "="))?.split("=")[1];
const variant = has("--day") ? "day" : "night";
const view = has("--close") ? "close" : "pano";

async function bridgeUp() {
  try {
    return (await fetch("http://127.0.0.1:4478/state")).ok;
  } catch {
    return false;
  }
}
if (!(await bridgeUp())) {
  const b = spawn(process.execPath, [path.join(here, "state.mjs"), "--pack", pack, "--port", "4478", ...(has("--demo") ? ["--demo"] : [])], {
    detached: true,
    stdio: "ignore",
  });
  b.unref();
  for (let i = 0; i < 20 && !(await bridgeUp()); i++) await new Promise((r) => setTimeout(r, 250));
  console.log(`state bridge started (pid ${b.pid})`);
}

let child;
if (engine === "godot") {
  const a = ["--path", path.join(here, "godot"), "--", `--pack=${pack}`, `--variant=${variant}`, `--view=${view}`, "--hud"];
  if (has("--on-top")) a.push("--on-top");
  if (has("--frameless")) a.push("--borderless");
  if (val("--opacity")) a.push(`--opacity=${val("--opacity")}`);
  child = spawn(godot, a, { detached: true, stdio: "ignore" });
} else {
  const exe = path.join(here, "electron/node_modules/electron/dist/electron.exe");
  if (!fs.existsSync(exe)) throw new Error("run npm install in proto/town-render/electron first");
  const a = [path.join(here, "electron"), `--url=http://127.0.0.1:4478/?variant=${variant}&view=${view}`, "--size=1440x720"];
  if (has("--on-top")) a.push("--on-top");
  if (has("--frameless")) a.push("--frameless");
  if (val("--opacity")) a.push(`--opacity=${val("--opacity")}`);
  child = spawn(exe, a, { detached: true, stdio: "ignore" });
}
child.unref();
console.log(`${engine} window started (pid ${child.pid})`);
