// Which kind of building a file becomes in a sprite theme, and how big (specs/06-themes.md).
// Pure. Kinds follow the role grouping (views.js roleOf); sizes are three tiers, cut at the repo's
// own line-count percentiles so a small repo still shows all three.

import { roleOf } from "./views.js";

export const KINDS = ["code", "test", "docs", "config", "other"];

const KIND_OF_ROLE = { code: "code", test: "test", spec: "docs", doc: "docs", config: "config", asset: "other" };

/** "code" | "test" | "docs" | "config" | "other" for a repo path. */
export function buildingKind(path) {
  return KIND_OF_ROLE[roleOf(path)] ?? "other";
}

/** [low, high] line counts: files at or below `low` are tier 0, above `high` tier 2. */
export function tierCuts(lineCounts) {
  const sorted = (lineCounts ?? []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0];
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(1 / 3), at(2 / 3)];
}

/** 0 | 1 | 2 for a file's line count, given tierCuts(). */
export function sizeTier(lines, [low, high]) {
  if (!(lines > low)) return 0;
  return lines > high ? 2 : 1;
}
