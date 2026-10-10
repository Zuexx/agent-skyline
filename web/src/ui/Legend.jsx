import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Bottom-right key for what the colors mean. While a branch is compared, its diff colors lead.
export default function Legend({ comparing = false }) {
  const items = [
    ...(comparing
      ? [
          { color: theme.added, key: "added" },
          { color: theme.written, key: "modified" },
          { color: theme.deleted, key: "deleted" },
        ]
      : []),
    { color: theme.read, key: "read" },
    ...(comparing ? [] : [{ color: theme.written, key: "written" }]),
    { color: theme.blocked, key: "blocked" },
    { color: theme.blocked, key: "zone", square: true },
    { color: theme.muted, key: "watcher" },
  ];
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 100,
        maxWidth: 340,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 8,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        padding: "10px 12px",
        lineHeight: 1.7,
        backdropFilter: "blur(6px)",
      }}
    >
      {items.map((it) => (
        <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              flexShrink: 0,
              borderRadius: it.square ? 2 : "50%",
              background: it.color,
              boxShadow: theme.bloom ? `0 0 8px ${it.color}` : "none",
            }}
          />
          <span style={{ fontWeight: 600 }}>{t(`legend.${it.key}`)}</span>
          <span style={{ color: theme.muted }}>{t(`legend.${it.key}Hint`)}</span>
        </div>
      ))}
      <div style={{ color: theme.muted, marginTop: 4 }}>{t("legend.footer")}</div>
      <div style={{ color: theme.muted }}>{t("legend.roads")}</div>
      <div style={{ color: theme.muted }}>{t("legend.controls")}</div>
    </div>
  );
}
