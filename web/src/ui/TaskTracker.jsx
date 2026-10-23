import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { agentColorIndex, formatClock } from "../lib/activity.js";
import { STAGES, taskState } from "../lib/tasks.js";
import { useNow } from "../lib/useNow.js";

const MAX_CHIPS = 6;

// Bottom-left tracker, WareTrack's shipment tracking for an agent's task: the prompt, and the five
// stages with the time each was reached. Blocked writes show as red marks on the stage they hit.
// `tasks`: the newest task of each agent (Map agent -> task); `task`: the one shown.
export default function TaskTracker({ tasks, task, agentName, onPickAgent, onFocusPath }) {
  const now = useNow();
  const chips = [...tasks.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, MAX_CHIPS);
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 100,
        width: 440,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        backdropFilter: "blur(6px)",
        padding: "10px 14px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.muted, marginRight: 4 }}>{t("tracker.title")}</span>
        {chips.map((c) => {
          const color = agentColor(c.agent);
          const on = c === task;
          return (
            <button
              key={c.agent}
              onClick={() => onPickAgent(c.agent)}
              style={{
                font: "inherit",
                fontSize: 11,
                padding: "1px 8px",
                borderRadius: 999,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                border: `1px solid ${on ? color : theme.panelBorder}`,
                background: on ? `${color}33` : "transparent",
                color: on ? theme.text : theme.muted,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
              {agentName(c)}
            </button>
          );
        })}
      </div>
      {!task ? (
        <div style={{ fontSize: 13, color: theme.muted, marginTop: 8 }}>{t("tracker.none")}</div>
      ) : (
        <TaskBody task={task} now={now} onFocusPath={onFocusPath} />
      )}
    </div>
  );
}

export function agentColor(agent) {
  return theme.agentColors[agentColorIndex(agent, theme.agentColors.length)];
}

function TaskBody({ task, now, onFocusPath }) {
  const state = taskState(task, now);
  const color = agentColor(task.agent);
  const current = STAGES.indexOf(task.stage);
  const minutes = Math.max(0, Math.round(((task.end ?? now) - task.start) / 60000));
  // Blocks per stage: the stage the task was in when the write was stopped.
  const blocksAt = STAGES.map(() => 0);
  for (const b of task.blocked) {
    let i = 0;
    STAGES.forEach((s, k) => task.reached[s] != null && task.reached[s] <= b.ts && (i = k));
    blocksAt[i]++;
  }
  return (
    <>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.prompt ?? ""}>
        {task.prompt ?? <span style={{ color: theme.muted, fontWeight: 400 }}>{t("tracker.noPrompt")}</span>}
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: theme.muted, marginTop: 2, alignItems: "center" }}>
        <span style={{ color: state === "working" ? theme.live : state === "done" ? theme.added : theme.muted, fontWeight: 700 }}>{t(`tracker.${state}`)}</span>
        <span>{t("tracker.elapsed", { m: minutes })}</span>
        <span>{t("tracker.counts", { reads: task.reads.size, writes: task.writes.size })}</span>
        {task.blocked.length > 0 && <span style={{ color: theme.blocked, fontWeight: 700 }}>{t("tracker.blocked", { n: task.blocked.length })}</span>}
        {task.lastPath && (
          <button
            onClick={() => onFocusPath(task.lastPath)}
            title={task.lastPath}
            style={{ marginLeft: "auto", font: "inherit", fontSize: 11, border: "none", background: "none", color: theme.read, cursor: "pointer", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0 }}
          >
            {task.lastPath.split("/").pop()}
          </button>
        )}
      </div>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, marginTop: 12 }}>
        {/* The track behind the dots: full length in the border color, reached part in the agent's color. */}
        <div style={{ position: "absolute", top: 8, left: "10%", right: "10%", height: 3, borderRadius: 2, background: theme.panelBorder }} />
        <div style={{ position: "absolute", top: 8, left: "10%", width: `${(current / (STAGES.length - 1)) * 80}%`, height: 3, borderRadius: 2, background: color }} />
        {STAGES.map((s, i) => {
          const at = task.reached[s];
          const reached = at != null && i <= current;
          const isCurrent = i === current && state !== "done";
          return (
            <div key={s} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                style={{
                  width: isCurrent ? 18 : 14,
                  height: isCurrent ? 18 : 14,
                  marginTop: isCurrent ? 0 : 2,
                  borderRadius: "50%",
                  boxSizing: "border-box",
                  background: reached ? color : theme.panelBg,
                  border: `2px solid ${reached ? color : theme.panelBorder}`,
                  boxShadow: isCurrent ? `0 0 0 4px ${color}44` : "none",
                }}
              />
              {blocksAt[i] > 0 && (
                <span
                  title={t("tracker.blocked", { n: blocksAt[i] })}
                  style={{ position: "absolute", top: -8, left: "calc(50% + 6px)", fontSize: 10, fontWeight: 800, color: "#fff", background: theme.blocked, borderRadius: 999, padding: "0 5px", lineHeight: "15px" }}
                >
                  !{blocksAt[i] > 1 ? blocksAt[i] : ""}
                </span>
              )}
              <span style={{ fontSize: 11, marginTop: 4, fontWeight: isCurrent ? 700 : 500, color: reached ? theme.text : theme.muted }}>{t(`stage.${s}`)}</span>
              <span style={{ fontSize: 10, color: theme.muted, fontFamily: "ui-monospace, monospace", minHeight: 13 }}>
                {reached ? formatClock(new Date(at).toISOString()).slice(0, 5) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
