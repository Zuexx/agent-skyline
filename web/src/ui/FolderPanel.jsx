import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { formatClock, splitPath } from "../lib/activity.js";

const MAX_FILES = 200;

const Label = ({ children }) => (
  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted, marginTop: 12 }}>{children}</div>
);

const lastTouch = (a) => Math.max(Date.parse(a?.lastWrite ?? "") || 0, Date.parse(a?.lastRead ?? "") || 0);

// Right-side list of the files in a building of the painted town (one folder = one building):
// files the agents touched come first, newest first, then the rest by name. Clicking a file opens
// its detail panel.
export default function FolderPanel({ id, name, files, activity, site = false, onFocusPath, onClose }) {
  if (!id) return null;
  const touched = files.filter((p) => lastTouch(activity[p]) > 0).sort((a, b) => lastTouch(activity[b]) - lastTouch(activity[a]));
  const touchedSet = new Set(touched);
  const rest = files.filter((p) => !touchedSet.has(p)).sort();
  const shown = [...touched, ...rest].slice(0, MAX_FILES);
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
        borderTop: "3px solid #b07a45",
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        padding: 14,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{name}</span>
        {site && <span style={{ fontSize: 11, fontWeight: 700, color: "#f3cf7a" }}>{t("folder.site")}</span>}
        <button onClick={onClose} title={t("agent.close")} style={{ marginLeft: "auto", border: "none", background: "none", color: theme.muted, cursor: "pointer", fontSize: 15 }}>
          ✕
        </button>
      </div>
      <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{t("folder.count", { n: files.length })}</div>

      {touched.length > 0 && <Label>{t("folder.touched", { n: touched.length })}</Label>}
      {shown.map((p, i) => (
        <div key={p}>
          {i === touched.length && touched.length > 0 && rest.length > 0 && <Label>{t("folder.others", { n: rest.length })}</Label>}
          <FileRow path={p} dir={id} a={activity[p]} onClick={() => onFocusPath(p)} />
        </div>
      ))}
      {files.length > MAX_FILES && <div style={{ fontSize: 12, color: theme.muted, marginTop: 6 }}>{t("folder.more", { n: files.length - MAX_FILES })}</div>}
    </div>
  );
}

function FileRow({ path, dir, a, onClick }) {
  const { name, dir: d } = splitPath(path);
  // the folder is in the title already: show only what is below it
  const sub = dir !== "(root)" && d.startsWith(dir) ? d.slice(dir.length + 1) : d;
  const wrote = Date.parse(a?.lastWrite ?? "") || 0;
  const color = a?.blocked > 0 ? theme.blocked : wrote ? theme.written : a?.lastRead ? theme.read : theme.panelBorder;
  const when = lastTouch(a);
  return (
    <button
      onClick={onClick}
      title={path}
      style={{ display: "flex", gap: 6, alignItems: "baseline", width: "100%", font: "inherit", fontSize: 12, textAlign: "left", padding: "2px 0", border: "none", background: "none", cursor: "pointer", color: theme.text }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, alignSelf: "center" }} />
      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", minWidth: 0, flex: 1 }}>{sub}</span>
      {when > 0 && <span style={{ fontFamily: "ui-monospace, monospace", color: theme.muted, flexShrink: 0 }}>{formatClock(new Date(when).toISOString()).slice(0, 5)}</span>}
    </button>
  );
}
