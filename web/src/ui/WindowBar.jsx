import { useEffect, useState } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// The slim title bar shown only inside the desktop window (specs/08), which injects
// `window.agentSkyline`. Drag it to move the window; double-click to maximize.
// The page fades itself (#root opacity) over the transparent window; the bar stays readable.

export const BAR_HEIGHT = 28;
const api = typeof window !== "undefined" ? window.agentSkyline : undefined;
export const inWindow = Boolean(api);

function Button({ label, onClick, on, children, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 34,
        height: BAR_HEIGHT,
        border: 0,
        padding: 0,
        cursor: "pointer",
        fontSize: 13,
        color: on ? "#fff" : theme.text,
        background: on ? theme.read : hover ? (danger ? "#c42b1c" : theme.panelBorder) : "transparent",
      }}
    >
      {children}
    </button>
  );
}

export default function WindowBar() {
  const [s, setS] = useState(api.state);
  useEffect(() => api.onChange(setS), []);

  // The page fades itself: #root carries the opacity, html/body stay transparent.
  useEffect(() => {
    document.getElementById("root").style.opacity = String(s.opacity);
  }, [s.opacity]);

  // Ctrl+Alt+Shift+Up/Down steps the opacity while the window has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey && e.altKey && e.shiftKey) || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const step = e.key === "ArrowUp" ? 0.1 : -0.1;
      api.setOpacity(Math.round((api.state.opacity + step) * 10) / 10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pct = Math.round(s.opacity * 100);
  return (
    <div
      onMouseDown={(e) => e.button === 0 && e.detail === 1 && api.drag()}
      onDoubleClick={() => api.toggleMaximize()}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: BAR_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: theme.panelBg,
        borderBottom: `1px solid ${theme.panelBorder}`,
        color: theme.text,
        font: "12px system-ui, sans-serif",
        userSelect: "none",
        zIndex: 2147483647,
      }}
    >
      <span style={{ paddingLeft: 10, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {s.clickThrough ? t("win.throughOn", { key: api.shortcut }) : document.title}
      </span>
      <span style={{ flex: 1 }} />
      <Button label={s.pinned ? t("win.unpin") : t("win.pin")} on={s.pinned} onClick={() => api.setPinned(!s.pinned)}>
        📌
      </Button>
      <label
        title={t("win.opacity", { n: pct })}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0.9 }}
      >
        <span style={{ fontSize: 13 }}>◐</span>
        <input
          type="range"
          min={30}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => api.setOpacity(Number(e.target.value) / 100)}
          style={{ width: 80 }}
        />
      </label>
      <Button
        label={t("win.through", { key: api.shortcut })}
        on={s.clickThrough}
        onClick={() => s.pinned && api.setClickThrough(!s.clickThrough)}
      >
        <span style={{ opacity: s.pinned ? 1 : 0.35 }}>⇣</span>
      </Button>
      <Button label={t("win.min")} onClick={() => api.minimize()}>
        –
      </Button>
      <Button label={t("win.max")} onClick={() => api.toggleMaximize()}>
        ▢
      </Button>
      <Button label={t("win.close")} onClick={() => api.close()} danger>
        ✕
      </Button>
    </div>
  );
}
