// Zone helpers for the UI. The matcher is the hooks' own (lib/glob.mjs), so the
// city can never disagree with the guard hook about what is locked.
import { matchGlob } from "../../../lib/glob.mjs";

export { matchGlob };

/** The glob a district lock is stored as. The root district cannot be locked. */
export function districtGlob(path) {
  return path ? `${path}/**` : null;
}

/** locked list with the district's glob added if absent, removed if present. */
export function toggleDistrictGlob(locked, path) {
  const glob = districtGlob(path);
  if (!glob) return locked;
  return locked.includes(glob) ? locked.filter((g) => g !== glob) : [...locked, glob];
}

export function isLockedPath(path, locked) {
  return locked.some((g) => matchGlob(g, path));
}
