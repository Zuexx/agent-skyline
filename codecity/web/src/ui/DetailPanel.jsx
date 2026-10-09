import { useEffect, useState } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { formatClock } from "../lib/activity.js";

const Row = ({ label, children }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted }}>{label}</div>
    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13, wordBreak: "break-all" }}>{children}</div>
  </div>
);

const statusColor = (s) => ({ A: theme.added, D: theme.deleted }[s] ?? theme.written);

// Right-side inspector for the selected building: file facts, dependencies, live activity, and
// a diff on demand. `diffSource` = { key, label, change, load(), emptyText? } — what the compared
// branch did to the file, or its uncommitted change in the working tree — or null for none.
export default function DetailPanel({ building, districtPath, fileActivity, diffSource = null, openUrl = null, deps = null, onFocusPath }) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [diff, setDiff] = useState(null);
  const [diffError, setDiffError] = useState(null);
  const change = diffSource?.change ?? null;

  // A new file, a new comparison or a new write closes or refreshes the previous diff.
  useEffect(() => {
    setDiff(null);
    setDiffError(null);
  }, [building?.path, diffSource?.key]);
  useEffect(() => setDiffOpen(false), [building?.path]);

  useEffect(() => {
    if (!diffOpen || diff || !change) return;
    diffSource
      .load()
      .then(setDiff)
      .catch((e) => setDiffError(e.message));
  }, [diffOpen, diff, change, diffSource]);

  if (!building) return null;
  const a = fileActivity;
  const hasActivity = a && (a.reads > 0 || a.writes > 0 || a.blocked > 0);

  return (
    <div
      style={{
        position: "fixed",
        top: 70,
        right: 12,
        width: diffOpen ? "min(640px, calc(100vw - 460px))" : 320,
        maxHeight: "calc(100vh - 230px)",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: `${theme.panelBorder} transparent`,
        zIndex: 100,
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        padding: 14,
        backdropFilter: "blur(6px)",
      }}
    >
      <Row label={t("detail.path")}>{building.path}</Row>
      {/* The working-tree copy; a file that exists only on a compared branch has nothing to open. */}
      {openUrl && (
        <a
          href={openUrl}
          title={t("detail.openHint")}
          style={{
            display: "inline-block",
            marginTop: 8,
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 6,
            border: `1px solid ${theme.read}`,
            color: theme.read,
            textDecoration: "none",
          }}
        >
          {t("detail.open")}
        </a>
      )}
      <Row label={t("detail.lines")}>{String(building.lines ?? 0)}</Row>
      <Row label={t("detail.folder")}>{districtPath || t("detail.root")}</Row>

      {deps && (deps.uses.length > 0 || deps.usedBy.length > 0 || deps.testedBy.length > 0) && (
        <div key={building.path} style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${theme.panelBorder}` }}>
          <DepList label={t("detail.uses")} color={theme.depUses} paths={deps.uses} onFocusPath={onFocusPath} />
          <DepList label={t("detail.usedBy")} color={theme.depUsedBy} paths={deps.usedBy} onFocusPath={onFocusPath} />
          <DepList label={t("detail.testedBy")} color={theme.added} paths={deps.testedBy} onFocusPath={onFocusPath} />
        </div>
      )}

      {diffSource && (change || diffSource.emptyText) && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${theme.panelBorder}` }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted }}>{diffSource.label}</div>
          {change ? (
            <>
              <div style={{ marginTop: 4, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: statusColor(change.status) }}>
                  {t(`detail.status.${change.status}`, { old: change.oldPath })}
                </span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                  <span style={{ color: theme.added }}>+{change.added}</span>{" "}
                  <span style={{ color: theme.deleted }}>−{change.removed}</span>
                </span>
                <button
                  onClick={() => setDiffOpen((o) => !o)}
                  style={{
                    marginLeft: "auto",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    border: `1px solid ${theme.read}`,
                    background: diffOpen ? theme.read : "transparent",
                    color: diffOpen ? "#fff" : theme.read,
                  }}
                >
                  {diffOpen ? t("detail.hideDiff") : t("detail.showDiff")}
                </button>
              </div>
              {diffOpen && <DiffView diff={diff} error={diffError} />}
            </>
          ) : (
            <div style={{ marginTop: 4, fontSize: 13, color: theme.muted }}>{diffSource.emptyText}</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${theme.panelBorder}` }}>
        {hasActivity ? (
          <>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted }}>{t("detail.activity")}</div>
            <div style={{ display: "flex", gap: 16, fontSize: 13, marginTop: 4 }}>
              <span>
                {t("detail.reads")} <b style={{ color: theme.read }}>{a.reads}</b>
              </span>
              <span>
                {t("detail.writes")} <b style={{ color: theme.written }}>{a.writes}</b>
              </span>
              <span>
                {t("detail.blocked")} <b style={{ color: theme.blocked }}>{a.blocked}</b>
              </span>
            </div>
            {a.lastRead && <Row label={t("detail.lastRead")}>{formatClock(a.lastRead)}</Row>}
            {a.lastWrite && <Row label={t("detail.lastWrite")}>{formatClock(a.lastWrite)}</Row>}
          </>
        ) : (
          <div style={{ fontSize: 13, color: theme.muted }}>{t("detail.none")}</div>
        )}
      </div>
    </div>
  );
}

const DEP_SHOWN = 6;

// One road kind: a colored key and the files at the other end, each clickable to fly there.
function DepList({ label, color, paths, onFocusPath }) {
  const [all, setAll] = useState(false);
  if (!paths.length) return null;
  const shown = all ? paths : paths.slice(0, DEP_SHOWN);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.muted }}>
        <span style={{ width: 14, height: 3, borderRadius: 2, background: color }} />
        {label} · {paths.length}
      </div>
      {shown.map((p) => (
        <button
          key={p}
          onClick={() => onFocusPath?.(p)}
          title={p}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            font: "inherit",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 12,
            padding: "1px 0",
            border: "none",
            background: "transparent",
            color: theme.text,
            cursor: "pointer",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            direction: "rtl", // keep the file name visible when the path is cut
          }}
        >
          {"‎" + p}
        </button>
      ))}
      {paths.length > DEP_SHOWN && (
        <button
          onClick={() => setAll((a) => !a)}
          style={{ font: "inherit", fontSize: 11, padding: 0, border: "none", background: "transparent", color: theme.read, cursor: "pointer" }}
        >
          {all ? t("detail.fewer") : t("detail.more", { n: paths.length - DEP_SHOWN })}
        </button>
      )}
    </div>
  );
}

function DiffView({ diff, error }) {
  if (error) return <div style={{ marginTop: 8, color: theme.blocked, fontSize: 12 }}>{error}</div>;
  if (!diff) return <div style={{ marginTop: 8, color: theme.muted, fontSize: 12 }}>…</div>;
  const lines = diff.text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  return (
    <div style={{ marginTop: 8 }}>
      <pre
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.45,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          background: "rgba(127,127,127,0.08)",
          borderRadius: 6,
          padding: "6px 0",
          overflowX: "auto",
        }}
      >
        {lines.slice(Math.max(0, start)).map((l, i) => {
          const c = l.startsWith("+") ? theme.added : l.startsWith("-") ? theme.deleted : l.startsWith("@@") ? theme.read : theme.text;
          const bg = l.startsWith("+") ? `${theme.added}1f` : l.startsWith("-") ? `${theme.deleted}1f` : "transparent";
          return (
            <div key={i} style={{ color: c, background: bg, padding: "0 10px", whiteSpace: "pre" }}>
              {l || " "}
            </div>
          );
        })}
      </pre>
      {diff.truncated && <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>{t("detail.diffTruncated")}</div>}
    </div>
  );
}
