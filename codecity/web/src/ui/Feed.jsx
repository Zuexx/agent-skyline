import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";
import { agentColorIndex, agentKeyOf, formatAgo, formatClock, sourceOf, splitPath } from "../lib/activity.js";

const FILTERS = {
  all: () => true,
  files: (ev) => ["read", "write", "blocked"].includes(ev.kind) || ev.readPaths?.length > 0,
  write: (ev) => ev.kind === "write",
  blocked: (ev) => ev.kind === "blocked",
  exec: (ev) => ev.kind === "exec" || ev.kind === "search",
};

const kindColor = (kind) =>
  ({ read: theme.read, write: theme.written, blocked: theme.blocked }[kind] ?? theme.muted);

const rowKey = (ev) => `${ev.ts}|${ev.session}|${ev.kind}|${ev.paths?.[0] ?? ""}|${ev.detail ?? ""}`;

// Bottom-left activity log for the whole session, newest first.
// - Scrolling down pauses it: new rows stop pushing the list, and a "N new" pill brings you back.
// - A file row flies the camera to that building and selects it.
// - A command row expands to the full command and the files it read, each clickable.
// `agentSeq` numbers agents per source (see activity.js); the watcher is one unnumbered source.
function agentLabel(ev, agentSeq) {
  const source = sourceOf(ev);
  if (source === "watcher") return t("source.watcher");
  const name = t(`source.${source}`);
  return `${name.startsWith("source.") ? source : name} ${agentSeq[agentKeyOf(ev)] ?? "?"}`;
}

export default function Feed({ feed, agentSeq = {}, onFocusPath }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null); // key of the expanded command row
  const [now, setNow] = useState(Date.now());
  const scroller = useRef(null);
  const [paused, setPaused] = useState(false);
  const seenTop = useRef(null); // newest row key at the moment the list was paused

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => (feed ?? []).filter(FILTERS[filter]), [feed, filter]);

  // While paused, keep the rows the user is looking at in place as new ones arrive on top.
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (paused) el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = el.scrollHeight;
  }, [rows, paused]);

  const newer = paused ? Math.max(0, rows.findIndex((ev) => rowKey(ev) === seenTop.current)) : 0;

  const onScroll = (e) => {
    const away = e.currentTarget.scrollTop > 8;
    if (away && !paused) seenTop.current = rows[0] ? rowKey(rows[0]) : null;
    if (away !== paused) setPaused(away);
  };
  const backToTop = () => {
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    setPaused(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px 6px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.muted, marginRight: 4 }}>
          {t("feed.title")} · {feed?.length ?? 0}
        </span>
        {Object.keys(FILTERS).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              font: "inherit",
              fontSize: 11,
              padding: "1px 8px",
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${filter === f ? theme.read : theme.panelBorder}`,
              background: filter === f ? theme.read : "transparent",
              color: filter === f ? "#fff" : theme.muted,
            }}
          >
            {t(`feed.filter.${f}`)}
          </button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        {paused && newer > 0 && (
          <button
            onClick={backToTop}
            style={{
              position: "absolute",
              top: 4,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 2,
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              padding: "3px 12px",
              borderRadius: 999,
              border: "none",
              background: theme.read,
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
            }}
          >
            {t("feed.newer", { n: newer })}
          </button>
        )}
        <div ref={scroller} onScroll={onScroll} style={{ maxHeight: "42vh", overflowY: "auto", padding: "0 6px 6px", scrollbarWidth: "thin", scrollbarColor: `${theme.panelBorder} transparent` }}>
          {!feed?.length && <div style={{ fontSize: 13, color: theme.muted, padding: "4px 6px 8px" }}>{t("feed.waiting")}</div>}
          {feed?.length > 0 && !rows.length && (
            <div style={{ fontSize: 13, color: theme.muted, padding: "4px 6px 8px" }}>{t("feed.empty")}</div>
          )}
          {rows.map((ev, i) => (
            <Row
              key={rowKey(ev) + i}
              ev={ev}
              now={now}
              agentLabel={agentLabel(ev, agentSeq)}
              open={open === rowKey(ev)}
              onToggle={() => setOpen((o) => (o === rowKey(ev) ? null : rowKey(ev)))}
              onFocusPath={onFocusPath}
              highlight={i === 0 && !paused}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ ev, now, agentLabel, open, onToggle, onFocusPath, highlight }) {
  const color = kindColor(ev.kind);
  const agentColor =
    sourceOf(ev) === "watcher" ? theme.muted : theme.agentColors[agentColorIndex(agentKeyOf(ev), theme.agentColors.length)];
  const path = ev.paths?.[0];
  const isFile = Boolean(path);
  const { name, dir } = splitPath(path);
  const command = !isFile ? String(ev.detail ?? ev.tool ?? "") : null;
  const reads = ev.readPaths ?? [];

  return (
    <div style={{ borderRadius: 6, background: highlight ? "rgba(127,127,127,0.08)" : "none", marginBottom: 1 }}>
      <button
        onClick={() => (isFile ? onFocusPath?.(path) : onToggle())}
        title={isFile ? path : command}
        style={{
          display: "grid",
          gridTemplateColumns: "44px 1fr auto",
          columnGap: 10,
          alignItems: "center",
          width: "100%",
          background: "none",
          border: "none",
          padding: "6px",
          cursor: "pointer",
          color: theme.text,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textAlign: "center",
            borderRadius: 4,
            padding: "2px 0",
            color,
            border: `1px solid ${color}`,
          }}
        >
          {t(`kind.${ev.kind}`)}
        </span>
        <span style={{ minWidth: 0 }}>
          {isFile ? (
            <>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
                {ev.repeat > 1 && <span style={{ color: theme.muted, fontWeight: 400 }}> ×{ev.repeat}</span>}
              </span>
              <span style={{ display: "block", fontSize: 11, color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {dir || t("detail.root")}
              </span>
            </>
          ) : (
            <span
              style={{
                display: "block",
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                color: theme.muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {open ? "▾ " : "▸ "}
              {command.replace(/\s+/g, " ")}
              {ev.repeat > 1 && ` ×${ev.repeat}`}
              {reads.length > 0 && <span style={{ color: theme.read }}> · {reads.length}📄</span>}
            </span>
          )}
        </span>
        <span style={{ textAlign: "right", fontSize: 11, lineHeight: 1.5 }} title={`${formatClock(ev.ts)}${sourceOf(ev) === "watcher" ? " · " + t("source.watcherHint") : ""}`}>
          <span style={{ display: "block", color: agentColor, fontWeight: 600 }}>{agentLabel}</span>
          <span style={{ display: "block", color: theme.muted }}>{formatAgo(ev.ts, now)}</span>
        </span>
      </button>
      {open && !isFile && (
        <div style={{ padding: "0 8px 8px 60px" }}>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color: theme.text,
              background: "rgba(127,127,127,0.1)",
              borderRadius: 6,
              padding: "6px 8px",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {command}
          </pre>
          {reads.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: theme.muted }}>{t("feed.files")}</span>
              {reads.map((p) => (
                <button
                  key={p}
                  onClick={() => onFocusPath?.(p)}
                  title={p}
                  style={{
                    font: "inherit",
                    fontSize: 11,
                    padding: "1px 8px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: `1px solid ${theme.read}`,
                    background: "transparent",
                    color: theme.read,
                  }}
                >
                  {splitPath(p).name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
