import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Shown while declaring the task scope: what clicking does, what a scope means (warn, not
// block), how it is inferred when nothing is declared, and the current list with one-click removal.
export default function ScopeBanner({ allow, onRemoveDistrict, onClear, onDone }) {
  const accent = theme.added;
  return (
    <div
      style={{
        position: "fixed",
        top: 120,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 110,
        maxWidth: "min(760px, calc(100vw - 32px))",
        background: theme.panelBg,
        border: `1px solid ${accent}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        padding: "12px 16px",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: accent }}>{t("scope.title")}</div>
      <div style={{ marginTop: 4, lineHeight: 1.6 }}>
        {t("scope.line1")}
        <br />
        <span style={{ color: theme.muted }}>{t("scope.line2")}</span>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ color: theme.muted }}>{t("scope.current")}</span>
        {allow.length === 0 && <span style={{ color: theme.muted }}>{t("scope.none")}</span>}
        {allow.map((g) => {
          const district = g.endsWith("/**") ? g.slice(0, -3) : null;
          return (
            <span
              key={g}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                background: `${accent}22`,
                border: `1px solid ${accent}`,
                borderRadius: 999,
                padding: "1px 4px 1px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {g}
              {district && (
                <button
                  onClick={() => onRemoveDistrict(district)}
                  style={{ border: "none", background: "none", color: theme.text, cursor: "pointer", fontSize: 13, padding: "0 4px" }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          {allow.length > 0 && (
            <button
              onClick={onClear}
              style={{ font: "inherit", padding: "4px 12px", borderRadius: 6, border: `1px solid ${theme.panelBorder}`, background: "transparent", color: theme.text, cursor: "pointer" }}
            >
              {t("scope.clear")}
            </button>
          )}
          <button
            onClick={onDone}
            style={{ font: "inherit", fontWeight: 600, padding: "4px 14px", borderRadius: 6, border: "none", background: accent, color: "#fff", cursor: "pointer" }}
          >
            {t("zone.done")}
          </button>
        </span>
      </div>
    </div>
  );
}
