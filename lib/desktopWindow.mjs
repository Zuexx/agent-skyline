// Open a repo's city in its own desktop window (specs/08): the Tauri app in desktop/, built on
// first use with cargo. One window per repo: its PID is kept next to its saved state
// (data/repos/<key>/window.json), and a second `skyline --window` reports the open one instead of
// opening another.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoDataDir } from "./paths.mjs";

const desktopDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop");
const exeName = process.platform === "win32" ? "agent-skyline-window.exe" : "agent-skyline-window";
export const windowExe = path.join(desktopDir, "target", "release", exeName);

// cargo from PATH, else rustup's default install folder (a shell started before rustup misses it).
function findCargo() {
  const bin = process.platform === "win32" ? "cargo.exe" : "cargo";
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore", windowsHide: true });
  if (probe.status === 0) return bin;
  const home = path.join(process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"), "bin", bin);
  return existsSync(home) ? home : null;
}

/** Build the window app once. Throws with what to install when cargo is missing. */
export function buildWindowOnce() {
  if (existsSync(windowExe)) return;
  const cargo = findCargo();
  if (!cargo) throw new Error("The desktop window needs Rust to build once: install it from https://rustup.rs, then run this again.");
  console.log("First run: building the desktop window (once, about two minutes)...");
  const r = spawnSync(cargo, ["build", "--release"], { cwd: desktopDir, stdio: "inherit", windowsHide: true });
  if (r.status !== 0 || !existsSync(windowExe)) throw new Error(`\`cargo build --release\` failed in ${desktopDir}`);
}

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
};

/** { opened: true, pid } or { opened: false, pid } when this repo's window is already open. */
export function openWindow({ repo, url }) {
  const dir = repoDataDir(repo);
  mkdirSync(dir, { recursive: true });
  const pidFile = path.join(dir, "window.pid");
  let old = null;
  try {
    old = JSON.parse(readFileSync(pidFile, "utf8"));
  } catch {}
  // The same window: alive, and for the same server URL (a restarted server may use another port).
  if (old && alive(old.pid) && old.url === url) return { opened: false, pid: old.pid };

  buildWindowOnce();
  const child = spawn(windowExe, [`--url=${url}/`, `--state=${path.join(dir, "window.json")}`, `--title=${path.basename(repo)}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true, // only hides a console; the window shows itself (see desktop/src/main.rs)
  });
  child.unref();
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, url }) + "\n");
  return { opened: true, pid: child.pid };
}
