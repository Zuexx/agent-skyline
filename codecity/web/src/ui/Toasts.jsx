import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { splitPath } from "../lib/activity.js";

// Top-right alert cards for fresh blocks and scope warnings. Click to fly to the building.
export default function Toasts({ toasts, describe, onOpen, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 120, display: "flex", flexDirection: "column", gap: 8, width: "min(380px, calc(100vw - 32px))" }}>
      {toasts.map((a) => {
        const color = a.level === "block" ? theme.blocked : theme.written;
        const { title, body } = describe(a);
        return (
          <div
            key={a.key}
            role="alert"
            onClick={() => onOpen?.(a)}
            style={{
              cursor: a.path ? "pointer" : "default",
              background: theme.panelBg,
              border: `1px solid ${color}`,
              borderLeft: `4px solid ${color}`,
              borderRadius: 8,
              padding: "8px 10px",
              color: theme.text,
              fontFamily: "system-ui, sans-serif",
              boxShadow: theme.bloom ? `0 0 18px ${color}55` : "0 4px 14px rgba(0,0,0,0.12)",
              backdropFilter: "blur(6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ color, fontSize: 13 }}>{title}</b>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(a.key);
                }}
                aria-label={t("toast.dismiss")}
                style={{ marginLeft: "auto", border: "none", background: "none", color: theme.muted, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            {a.path && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, marginTop: 2 }}>{splitPath(a.path).name}</div>}
            <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{body}</div>
          </div>
        );
      })}
    </div>
  );
}
