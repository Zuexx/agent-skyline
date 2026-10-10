// Shared data-file resolution for all Agent Skyline entry points (hooks and CLI).
// Every script resolves its files through this module so the three cannot drift.

import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export const defaultLogFile = path.join(dataDir, "events.jsonl");
export const defaultZonesFile = path.join(dataDir, "zones.json");

function envValue(name) {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// AGENT_SKYLINE_EVENTS overrides the default event log location.
export function resolveLogFile() {
  return envValue("AGENT_SKYLINE_EVENTS") ?? defaultLogFile;
}

// Where auto-started servers record their PIDs (so they can be stopped by PID, never by name).
// AGENT_SKYLINE_SERVERS overrides it.
export function resolveServersDir() {
  return envValue("AGENT_SKYLINE_SERVERS") ?? path.join(dataDir, "servers");
}

// AGENT_SKYLINE_ZONES overrides the default zones config location.
export function resolveZonesFile() {
  return envValue("AGENT_SKYLINE_ZONES") ?? defaultZonesFile;
}
