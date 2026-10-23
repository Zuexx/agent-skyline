import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { formatClock, splitPath } from "../lib/activity.js";
import { taskState } from "../lib/tasks.js";
import { useNow } from "../lib/useNow.js";
import { agentColor } from "./TaskTracker.jsx";

const MAX_FILES = 40;

const Label = ({ children }) => (
  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted, marginTop: 12 }}>{children}</div>
);

// Right-side inspector for the selected agent, like WareTrack's truck panel: what it was asked,
// where it is in the task, how long it has taken, and every file it touched (click to fly there).
export default function AgentPanel({ task, name, onFocusPath, onClose }) {
  const now = useNow();
  if (!task) return null;
  const color = agentColor(task.agent);
  const state = taskState(task, now);
  const minutes = Math.max(0, Math.round(((task.end ?? now) - task.start) / 60000));
  const touched = [...new Set([...task.writes, ...task.reads])];
  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        right: 12,
        width: 320,
        maxHeight: "calc(100vh - 230px)",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: `${theme.panelBorder} transparent`,
        zIndex: 100,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        padding: 14,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: color }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: state === "working" ? theme.live : state === "done" ? theme.added : theme.muted }}>{t(`tracker.${state}`)}</span>
        <button onClick={onClose} title={t("agent.close")} style={{ marginLeft: "auto", border: "none", background: "none", color: theme.muted, cursor: "pointer", fontSize: 15 }}>
          ✕
        </button>
      </div>

      <Label>{t("agent.task")}</Label>
      <div style={{ fontSize: 13, marginTop: 2 }}>{task.prompt ?? <span style={{ color: theme.muted }}>{t("tracker.noPrompt")}</span>}</div>

      <div style={{ display: "flex", gap: 24 }}>
        <div>
          <Label>{t("agent.stage")}</Label>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{t(`stage.${task.stage}`)}</div>
        </div>
        <div>
          <Label>{t("agent.elapsed")}</Label>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{t("tracker.elapsed", { m: minutes })}</div>
        </div>
      </div>

      {task.lastPath && (
        <>
          <Label>{t("agent.current")}</Label>
          <PathButton path={task.lastPath} onClick={() => onFocusPath(task.lastPath)} />
        </>
      )}

      {task.checks.length > 0 && (
        <>
          <Label>{t("agent.checks")}</Label>
          {task.checks.slice(-5).map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, marginTop: 3, alignItems: "baseline" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", color: theme.muted }}>{formatClock(new Date(c.ts).toISOString()).slice(0, 5)}</span>
              <span style={{ fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, color: c.outcome === "passed" ? theme.added : c.outcome === "failed" ? theme.blocked : theme.muted }}>{t(`kpi.${c.outcome ?? "unknown"}`)}</span>
              <span style={{ fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.command ?? ""}>
                {c.command}
              </span>
            </div>
          ))}
        </>
      )}

      {task.blocked.length > 0 && (
        <>
          <Label>{t("agent.blocked")}</Label>
          {task.blocked.map((b, i) => (
            <PathButton key={i} path={b.path ?? "?"} color={theme.blocked} title={b.reason ?? ""} onClick={() => b.path && onFocusPath(b.path)} />
          ))}
        </>
      )}

      <Label>{t("agent.touched", { n: touched.length })}</Label>
      {touched.slice(0, MAX_FILES).map((p) => (
        <PathButton key={p} path={p} color={task.writes.has(p) ? theme.written : theme.read} onClick={() => onFocusPath(p)} />
      ))}
    </div>
  );
}

function PathButton({ path, color = theme.text, title, onClick }) {
  const { name, dir } = splitPath(path);
  return (
    <button
      onClick={onClick}
      title={title || path}
      style={{ display: "flex", gap: 6, alignItems: "baseline", width: "100%", font: "inherit", fontSize: 12, textAlign: "left", padding: "2px 0", border: "none", background: "none", cursor: "pointer", color: theme.text }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, alignSelf: "center" }} />
      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", minWidth: 0 }}>{dir}</span>
    </button>
  );
}
