import { useEffect, useState } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { splitPath } from "../lib/activity.js";

// Remember which files were already looked at, per comparison (or per live session). Browser
// storage is a convenience only: if it is unavailable, the checkmarks simply do not persist.
function useReviewed(scopeKey) {
  const storageKey = `codecity.reviewed.${scopeKey}`;
  const [done, setDone] = useState(() => new Set());
  useEffect(() => {
    try {
      setDone(new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]")));
    } catch {
      setDone(new Set());
    }
  }, [storageKey]);
  const toggle = (path) =>
    setDone((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // storage blocked: keep the checkmark for this page only
      }
      return next;
    });
  return { done, toggle };
}

const reasonColor = (key) =>
  ({ warning: theme.warn, deletedUsed: theme.deleted, untested: theme.blocked, churn: theme.written, usedBy: theme.depUsedBy }[key] ??
  theme.muted);

// Bottom-left, in place of the activity feed: the changed files, riskiest first, each with the
// reasons for its place. Click a row to fly there (and, while comparing, open its diff from the
// detail panel); tick it off once reviewed.
export default function ReviewPanel({ ranked, scopeKey, onFocusPath, onClose }) {
  const { done, toggle } = useReviewed(scopeKey);
  const reviewed = ranked.filter((r) => done.has(r.path)).length;
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 100,
        width: 420,
        maxHeight: "calc(100vh - 200px)", // clear of the top bar and the comparison summary
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 6px" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.muted }}>{t("review.title", { n: ranked.length })}</span>
        <span style={{ fontSize: 11, color: theme.muted }}>{t("review.progress", { done: reviewed, n: ranked.length })}</span>
        <button
          onClick={onClose}
          title={t("review.close")}
          style={{ marginLeft: "auto", font: "inherit", fontSize: 14, border: "none", background: "transparent", color: theme.muted, cursor: "pointer" }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: 11, color: theme.muted, padding: "0 12px 6px" }}>{t("review.hint")}</div>
      <div style={{ overflowY: "auto", scrollbarWidth: "thin", padding: "0 6px 8px" }}>
        {ranked.length === 0 && <div style={{ fontSize: 13, color: theme.muted, padding: "8px 6px" }}>{t("review.empty")}</div>}
        {ranked.map((r, i) => {
          const { name, dir } = splitPath(r.path);
          const isDone = done.has(r.path);
          return (
            <div
              key={r.path}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px", borderRadius: 6, opacity: isDone ? 0.45 : 1 }}
            >
              <input
                type="checkbox"
                checked={isDone}
                onChange={() => toggle(r.path)}
                title={t("review.mark")}
                style={{ marginTop: 3, accentColor: theme.added, cursor: "pointer" }}
              />
              <button
                onClick={() => onFocusPath?.(r.path)}
                title={r.path}
                style={{ flex: 1, minWidth: 0, textAlign: "left", font: "inherit", border: "none", background: "transparent", color: theme.text, cursor: "pointer", padding: 0 }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: theme.muted, width: 18, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  {r.status && <span style={{ fontSize: 11, color: theme.muted }}>{r.status}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: theme.muted, flexShrink: 0 }}>{r.score.toFixed(1)}</span>
                </div>
                <div style={{ paddingLeft: 24, fontSize: 11, color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dir || t("detail.root")}
                </div>
                {r.reasons.length > 0 && (
                  <div style={{ paddingLeft: 24, display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                    {r.reasons.map((x) => (
                      <span
                        key={x.key}
                        title={t(`review.why.${x.key}Hint`)}
                        style={{
                          fontSize: 10.5,
                          padding: "0 6px",
                          borderRadius: 999,
                          border: `1px solid ${reasonColor(x.key)}`,
                          color: reasonColor(x.key),
                        }}
                      >
                        {t(`review.why.${x.key}`, { n: x.n })}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
