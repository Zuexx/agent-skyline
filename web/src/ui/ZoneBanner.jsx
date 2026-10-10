import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Shown while zone mode is on: says what to do, what a lock means, and lists current locks
// with a one-click unlock for district locks ("<path>/**").
export default function ZoneBanner({ locked, onUnlockDistrict, onDone }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 120,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 110,
        maxWidth: "min(720px, calc(100vw - 32px))",
        background: theme.panelBg,
        border: `1px solid ${theme.blocked}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        padding: "12px 16px",
        boxShadow: `0 0 24px rgba(255, 51, 85, 0.35)`,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: theme.blocked }}>{t("zone.title")}</div>
      <div style={{ marginTop: 4, lineHeight: 1.6 }}>
        {t("zone.line1")}
        <br />
        {t("zone.line2")}
      </div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ color: theme.muted }}>{t("zone.current")}</span>
        {locked.length === 0 && <span style={{ color: theme.muted }}>{t("zone.none")}</span>}
        {locked.map((g) => {
          const district = g.endsWith("/**") ? g.slice(0, -3) : null;
          return (
            <span
              key={g}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                background: `${theme.blocked}22`,
                border: `1px solid ${theme.blocked}`,
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
                  title={t("zone.unlock", { glob: g })}
                  onClick={() => onUnlockDistrict(district)}
                  style={{ border: "none", background: "none", color: theme.text, cursor: "pointer", fontSize: 13, padding: "0 4px" }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button
          onClick={onDone}
          style={{
            marginLeft: "auto",
            font: "inherit",
            fontWeight: 600,
            padding: "4px 14px",
            borderRadius: 6,
            border: "none",
            background: theme.blocked,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {t("zone.done")}
        </button>
      </div>
    </div>
  );
}
