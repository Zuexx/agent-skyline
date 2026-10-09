// Shared data-file resolution for all CodeCity entry points (hooks and CLI).
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

// CODECITY_EVENTS overrides the default event log location.
export function resolveLogFile() {
  return envValue("CODECITY_EVENTS") ?? defaultLogFile;
}

// Where auto-started servers record their PIDs (so they can be stopped by PID, never by name).
// CODECITY_SERVERS overrides it.
export function resolveServersDir() {
  return envValue("CODECITY_SERVERS") ?? path.join(dataDir, "servers");
}

// CODECITY_ZONES overrides the default zones config location.
export function resolveZonesFile() {
  return envValue("CODECITY_ZONES") ?? defaultZonesFile;
}
