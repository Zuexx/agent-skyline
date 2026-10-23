import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Turn the fixed camera 90° left or right (also Q / E). Shown only in sprite themes.
export default function TurnButtons({ onTurn }) {
  const btn = {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: `1px solid ${theme.panelBorder}`,
    background: theme.panelBg,
    color: theme.text,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    backdropFilter: "blur(6px)",
  };
  return (
    <div style={{ position: "fixed", right: 12, top: "45%", zIndex: 100, display: "flex", flexDirection: "column", gap: 6 }}>
      <button style={btn} title={t("turn.left")} aria-label={t("turn.left")} onClick={() => onTurn(1)}>
        ⟲
      </button>
      <button style={btn} title={t("turn.right")} aria-label={t("turn.right")} onClick={() => onTurn(-1)}>
        ⟳
      </button>
    </div>
  );
}
