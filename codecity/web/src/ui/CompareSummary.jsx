import { useMemo } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { roleOf } from "../lib/views.js";

const ROLES = ["code", "test", "spec", "doc", "config", "asset"];

// Card under the top bar while comparing: what the branch changed, in numbers and by role, so
// "did the code change come with tests?" is answered at a glance.
export default function CompareSummary({ compare, onClose }) {
  const byRole = useMemo(() => {
    const m = new Map();
    for (const f of compare.diff?.values() ?? []) m.set(roleOf(f.path), (m.get(roleOf(f.path)) ?? 0) + 1);
    return m;
  }, [compare.diff]);

  if (!compare.active) return null;
  const s = compare.summary;
  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        left: 12,
        zIndex: 100,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        padding: "10px 14px",
        backdropFilter: "blur(6px)",
        maxWidth: 400,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
          {t("summary.title", { head: compare.head, base: compare.base })}
        </span>
        <button
          onClick={onClose}
          title={t("summary.close")}
          style={{ marginLeft: "auto", border: "none", background: "none", color: theme.muted, cursor: "pointer", fontSize: 15 }}
        >
          ✕
        </button>
      </div>
      <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
        {t("summary.stats", { files: s.files, added: s.added, removed: s.removed })
          .split(/(\+\d+|−\d+)/)
          .map((part, i) => (
            <span key={i} style={{ color: part.startsWith("+") ? theme.added : part.startsWith("−") ? theme.deleted : theme.text }}>
              {part}
            </span>
          ))}
      </div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ROLES.filter((r) => byRole.get(r)).map((r) => (
          <span
            key={r}
            style={{
              fontSize: 12,
              padding: "1px 9px",
              borderRadius: 999,
              border: `1px solid ${theme.panelBorder}`,
              background: "rgba(127,127,127,0.08)",
            }}
          >
            {t(`group.${r}`)} <b>{byRole.get(r)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
