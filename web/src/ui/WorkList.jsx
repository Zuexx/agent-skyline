import { useMemo } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { formatAgo, splitPath } from "../lib/activity.js";
import { taskState } from "../lib/tasks.js";
import { useNow } from "../lib/useNow.js";
import Feed from "./Feed.jsx";
import Legend from "./Legend.jsx";
import { agentColor } from "./TaskTracker.jsx";

export const TABS = ["feed", "agents", "files", "blocked", "legend"];
const MAX_ROWS = 200;

// Bottom-right tabbed list, WareTrack's docks / forklifts / trucks table: the live feed, the
// agents, the files touched and what was blocked or flagged. Every row selects what it names.
export default function WorkList({ tab, onTab, feedProps, tasks, files, issues, comparing, agentName, selectedAgent, onPickAgent, onFocusPath }) {
  const now = useNow();
  const counts = { agents: tasks.size, files: files.length, blocked: issues.length };
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 100,
        width: 400,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", gap: 2, padding: "8px 8px 6px", borderBottom: `1px solid ${theme.panelBorder}`, marginBottom: 6 }}>
        {TABS.map((id) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            style={{
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              background: tab === id ? `${theme.read}26` : "transparent",
              color: tab === id ? theme.text : theme.muted,
            }}
          >
            {t(`list.${id}`)}
            {counts[id] > 0 && <span style={{ marginLeft: 5, color: id === "blocked" ? theme.blocked : theme.muted }}>{counts[id]}</span>}
          </button>
        ))}
      </div>
      {tab === "feed" && <Feed embedded {...feedProps} />}
      {tab === "legend" && <Legend embedded comparing={comparing} />}
      {tab === "agents" && (
        <Rows empty={!tasks.size}>
          {[...tasks.values()]
            .sort((a, b) => b.lastTs - a.lastTs)
            .map((task) => {
              const state = taskState(task, now);
              return (
                <Row key={task.agent} onClick={() => onPickAgent(task.agent)} active={task.agent === selectedAgent}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: agentColor(task.agent), flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, minWidth: 64 }}>{agentName(task)}</span>
                  <span style={{ color: state === "working" ? theme.live : theme.muted, minWidth: 56 }}>{t(`stage.${task.stage}`)}</span>
                  <Ellipsis title={task.prompt ?? task.lastPath ?? ""}>{task.prompt ?? task.lastPath ?? ""}</Ellipsis>
                  <span style={{ color: theme.muted, fontSize: 11 }}>{formatAgo(new Date(task.lastTs).toISOString(), now)}</span>
                </Row>
              );
            })}
        </Rows>
      )}
      {tab === "files" && (
        <Rows empty={!files.length}>
          {files.slice(0, MAX_ROWS).map((f) => (
            <FileRow key={f.path} path={f.path} onClick={() => onFocusPath(f.path)}>
              {f.writes > 0 && <span style={{ color: theme.written, fontWeight: 700 }}>✎{f.writes}</span>}
              {f.reads > 0 && <span style={{ color: theme.read }}>👁{f.reads}</span>}
            </FileRow>
          ))}
        </Rows>
      )}
      {tab === "blocked" && (
        <Rows empty={!issues.length}>
          {issues.slice(0, MAX_ROWS).map((it, i) => (
            <FileRow key={`${it.ts}|${it.path}|${i}`} path={it.path} onClick={() => onFocusPath(it.path)} title={it.reason ?? ""}>
              <span style={{ color: it.kind === "blocked" ? theme.blocked : theme.warn, fontWeight: 700 }}>{it.kind === "blocked" ? t("kind.blocked") : t(`alert.${it.rule}`)}</span>
            </FileRow>
          ))}
        </Rows>
      )}
    </div>
  );
}

function Rows({ empty, children }) {
  return (
    <div style={{ maxHeight: "36vh", overflowY: "auto", padding: "0 6px 8px", scrollbarWidth: "thin", scrollbarColor: `${theme.panelBorder} transparent` }}>
      {empty ? <div style={{ fontSize: 13, color: theme.muted, padding: "4px 6px 8px" }}>{t("list.empty")}</div> : children}
    </div>
  );
}

function Row({ onClick, active = false, title = undefined, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        font: "inherit",
        fontSize: 12,
        textAlign: "left",
        padding: "5px 6px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        color: theme.text,
        background: active ? `${theme.read}22` : "none",
      }}
    >
      {children}
    </button>
  );
}

function FileRow({ path, onClick, title, children }) {
  const { name, dir } = splitPath(path);
  return (
    <Row onClick={onClick} title={title || path}>
      <span style={{ fontWeight: 600, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{name}</span>
      <Ellipsis muted>{dir}</Ellipsis>
      <span style={{ display: "flex", gap: 8, fontSize: 11 }}>{children}</span>
    </Row>
  );
}

function Ellipsis({ children, muted = false, title = undefined }) {
  return (
    <span title={title} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: muted ? theme.muted : theme.text, direction: muted ? "rtl" : "ltr", textAlign: "left" }}>
      {children}
    </span>
  );
}

/** Files touched in the shown range, writes first, then by activity: [{ path, reads, writes }]. */
export function useTouchedFiles(files) {
  return useMemo(
    () =>
      Object.entries(files ?? {})
        .filter(([p, f]) => !p.startsWith("/") && !/^[a-z]:\//i.test(p) && (f.reads > 0 || f.writes > 0))
        .map(([path, f]) => ({ path, reads: f.reads, writes: f.writes }))
        .sort((a, b) => (b.writes > 0) - (a.writes > 0) || b.writes + b.reads - (a.writes + a.reads) || a.path.localeCompare(b.path)),
    [files]
  );
}
