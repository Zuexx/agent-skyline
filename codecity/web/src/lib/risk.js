// Order changed files for review: riskiest first, each with the reasons behind its place, so the
// order can be checked rather than trusted. Signals (all cheap, all already known to the city):
//   warning      a scope warning or a blocked write on the file this session
//   untested     code that no test file uses (from the dependency roads)
//   churn        changed in many commits lately (git log; bugs cluster where code keeps moving)
//   usedBy       many files depend on it, so a mistake spreads
//   big          a large change (diff lines while comparing, repeated writes while live)
//   deletedUsed  a deleted file that other files still use
// Tests, docs and assets count for less: a mistake there rarely breaks the product.
import { depsOf } from "./deps.js";
import { roleOf } from "./views.js";

const ROLE_WEIGHT = { code: 1, config: 1, test: 0.6, spec: 0.2, doc: 0.2, asset: 0.2 };

/**
 * items: [{ path, status?, added?, removed?, writes? }] — the changed files.
 * ctx: { churn: { path: commits }, deps: dep index, warned: Set of paths }.
 * Returns [{ ...item, score, reasons: [{ key, n? }] }], highest score first.
 */
export function rankReview(items, ctx = {}) {
  const ranked = items.map((it) => {
    const role = roleOf(it.path);
    const d = depsOf(ctx.deps, it.path);
    const reasons = [];
    let score = 0;
    if (ctx.warned?.has(it.path)) {
      score += 4;
      reasons.push({ key: "warning" });
    }
    if (it.status === "D" && d.usedBy.length > 0) {
      score += 3;
      reasons.push({ key: "deletedUsed", n: d.usedBy.length });
    }
    if (role === "code" && it.status !== "D" && ctx.deps && d.testedBy.length === 0) {
      score += 3;
      reasons.push({ key: "untested" });
    }
    const commits = ctx.churn?.[it.path] ?? 0;
    score += Math.min(commits, 15) / 5;
    if (commits >= 5) reasons.push({ key: "churn", n: commits });
    const users = d.usedBy.length;
    score += Math.min(users, 12) / 4;
    if (users >= 3) reasons.push({ key: "usedBy", n: users });
    if (it.added != null || it.removed != null) {
      const lines = (it.added ?? 0) + (it.removed ?? 0);
      score += Math.min(lines, 300) / 100;
      if (lines >= 100) reasons.push({ key: "big", n: lines });
    } else if (it.writes) {
      score += Math.min(it.writes, 6) / 2;
      if (it.writes >= 3) reasons.push({ key: "rewrites", n: it.writes });
    }
    return { ...it, role, score: Math.round(score * (ROLE_WEIGHT[role] ?? 1) * 10) / 10, reasons };
  });
  return ranked.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
}

/** Changed files to review: the compared branch's diff, or what was written this session. */
export function reviewItems({ diff, files }) {
  if (diff) return [...diff.values()].map((f) => ({ path: f.path, status: f.status, added: f.added, removed: f.removed }));
  return Object.entries(files ?? {})
    .filter(([, f]) => f.writes > 0 || f.blocked > 0)
    .map(([path, f]) => ({ path, writes: f.writes }));
}
