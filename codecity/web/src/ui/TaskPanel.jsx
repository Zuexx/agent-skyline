import { useState } from "react";
import { theme } from "../theme.js";
import { getLocale, t } from "../lib/i18n.js";
import { taskPrompt } from "../lib/selection.js";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or a blocked permission: fall back to a hidden textarea and execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const btn = (accent, filled = false) => ({
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 10px",
  borderRadius: 6,
  cursor: "pointer",
  border: `1px solid ${accent}`,
  background: filled ? accent : "transparent",
  color: filled ? "#fff" : accent,
});

// Right side, while buildings are picked in select mode: the picked files become a task.
// - Copy: the task text plus the file list as its scope, ready to paste into Claude Code.
// - Use as scope: the files become the declared task scope, so writes elsewhere raise warnings.
export default function TaskPanel({ paths, onRemove, onClear, onSetScope, onFocusPath }) {
  const [task, setTask] = useState("");
  const [note, setNote] = useState(null);
  const sorted = [...paths].sort();
  const flash = (msg) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        right: 12,
        width: 360,
        maxHeight: "calc(100vh - 230px)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        padding: 14,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{t("task.title", { n: sorted.length })}</div>
      <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{t("task.hint")}</div>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder={t("task.placeholder")}
        rows={3}
        style={{
          marginTop: 10,
          font: "inherit",
          fontSize: 13,
          padding: 8,
          borderRadius: 6,
          resize: "vertical",
          border: `1px solid ${theme.panelBorder}`,
          background: "transparent",
          color: theme.text,
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button
          style={btn(theme.read, true)}
          title={t("task.copyHint")}
          onClick={async () => flash((await copyText(taskPrompt(task, sorted, getLocale()))) ? t("task.copied") : t("task.copyFailed"))}
        >
          {t("task.copy")}
        </button>
        <button
          style={btn(theme.added)}
          title={t("task.scopeHint")}
          onClick={async () => {
            await onSetScope?.(sorted);
            flash(t("task.scoped", { n: sorted.length }));
          }}
        >
          {t("task.scope")}
        </button>
        <button style={btn(theme.muted)} onClick={onClear}>
          {t("task.clear")}
        </button>
      </div>
      {note && <div style={{ fontSize: 12, color: theme.added, marginTop: 6 }}>{note}</div>}
      <div style={{ marginTop: 10, overflowY: "auto", scrollbarWidth: "thin", borderTop: `1px solid ${theme.panelBorder}`, paddingTop: 6 }}>
        {sorted.map((p) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => onFocusPath?.(p)}
              title={p}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                font: "inherit",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 12,
                padding: "2px 0",
                border: "none",
                background: "transparent",
                color: theme.text,
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                direction: "rtl",
              }}
            >
              {"‎" + p}
            </button>
            <button
              onClick={() => onRemove?.(p)}
              title={t("task.remove")}
              style={{ font: "inherit", fontSize: 12, border: "none", background: "transparent", color: theme.muted, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
