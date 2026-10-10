// Pure path helpers. Paths use forward slashes, as in the /api/city payload.

/** Directory containing `path`, or "" for a root-level file. */
export function parentDir(path) {
  const i = String(path).lastIndexOf("/");
  return i === -1 ? "" : String(path).slice(0, i);
}
