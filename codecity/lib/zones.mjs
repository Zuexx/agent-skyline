// Locked-zone config loading and blocking decisions.
// loadZones does file I/O; decide is pure.

import { readFile } from "node:fs/promises";
import { matchGlob } from "./glob.mjs";

// Read the zones config. A missing file means "no zones defined" (allow);
// an unreadable or malformed file is reported as invalid so callers can fail
// closed — a broken config means the user intended to lock something.
export async function loadZones(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return { status: "missing" };
    return { status: "invalid", error: `cannot read ${file}: ${err.message}` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { status: "invalid", error: `not valid JSON: ${err.message}` };
  }

  const locked = data !== null && typeof data === "object" ? data.locked : undefined;
  if (!Array.isArray(locked) || !locked.every((g) => typeof g === "string")) {
    return { status: "invalid", error: 'locked must be an array of strings' };
  }

  return { status: "ok", locked };
}

// Decide whether a normalized event is blocked by the zones config.
// Only write events can be blocked; everything else is allowed.
export function decide(event, zones) {
  const ev = event !== null && typeof event === "object" ? event : {};
  if (ev.kind !== "write") return { allow: true };

  const paths = Array.isArray(ev.paths) ? ev.paths.filter((p) => typeof p === "string") : [];

  if (zones.status === "missing") return { allow: true };

  if (zones.status === "invalid") {
    // Fail closed: the user meant to lock something.
    return {
      allow: false,
      reason: `codecity: zones.json is invalid (${zones.error}); fix it or delete it`,
      path: paths[0] ?? null,
      zone: null,
    };
  }

  for (const p of paths) {
    for (const zone of zones.locked) {
      if (matchGlob(zone, p)) {
        return { allow: false, reason: `codecity: ${p} is in locked zone "${zone}"`, path: p, zone };
      }
    }
  }

  return { allow: true };
}
