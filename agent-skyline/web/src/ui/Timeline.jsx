import { useMemo } from "react";
import { theme } from "../theme.js";
import { t as tr } from "../lib/i18n.js";
import { formatClock } from "../lib/activity.js";
import { timelineMarks } from "../lib/replay.js";
import Icon from "./Icon.jsx";

const SPEEDS = [1, 8, 32, 120];

// Bottom-center replay bar. Idle: one button to replay the session. Active: play/pause, a track
// with every write (amber) and block (red) marked, a scrubber, speed, and a way back to live.
export default function Timeline({ replay, feed }) {
  const marks = useMemo(() => (replay.active ? timelineMarks(feed, replay.range) : []), [replay.active, feed, replay.range]);
  const panel = {
    position: "fixed",
    bottom: 12,
    left: "calc(50% - 40px)",
    transform: "translateX(-50%)",
    zIndex: 100,
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 10,
    color: theme.text,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    backdropFilter: "blur(6px)",
  };
  const btn = {
    font: "inherit",
    fontWeight: 600,
    height: 28,
    padding: "0 10px",
    borderRadius: 7,
    border: `1px solid ${theme.panelBorder}`,
    background: "transparent",
    color: theme.text,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  if (!replay.active) {
    if (!replay.range) return null;
    return (
      <div style={{ ...panel, padding: 6 }}>
        <button style={btn} onClick={replay.start} title={tr("timeline.replayHint")}>
          <Icon name="replay" size={16} /> {tr("timeline.replay")}
        </button>
      </div>
    );
  }

  const [a, b] = replay.range;
  const pos = b > a ? (replay.t - a) / (b - a) : 1;
  return (
    <div style={{ ...panel, width: "min(560px, calc(100vw - 820px))", minWidth: 340, padding: "8px 10px", display: "flex", alignItems: "center", gap: 10 }}>
      <button style={{ ...btn, width: 32, padding: 0, justifyContent: "center" }} onClick={replay.toggle} aria-label={replay.playing ? tr("timeline.pause") : tr("timeline.play")}>
        <Icon name={replay.playing ? "pause" : "play"} size={16} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: "relative", height: 18 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 3, borderRadius: 2, background: theme.panelBorder }} />
          <div style={{ position: "absolute", left: 0, width: `${pos * 100}%`, top: 8, height: 3, borderRadius: 2, background: theme.read }} />
          {marks.map((m, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                left: `${m.at * 100}%`,
                top: m.kind === "blocked" ? 2 : 4,
                width: 2,
                height: m.kind === "blocked" ? 14 : 10,
                background: m.kind === "blocked" ? theme.blocked : theme.written,
                opacity: 0.85,
              }}
            />
          ))}
          <input
            type="range"
            min={a}
            max={b}
            value={replay.t}
            onChange={(e) => replay.seek(Number(e.target.value))}
            aria-label={tr("timeline.seek")}
            style={{ position: "absolute", inset: 0, width: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
          />
          <span style={{ position: "absolute", left: `${pos * 100}%`, top: 3, width: 12, height: 12, marginLeft: -6, borderRadius: "50%", background: theme.read, boxShadow: theme.bloom ? `0 0 8px ${theme.read}` : "none", pointerEvents: "none" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: theme.muted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
          <span>{formatClock(new Date(a).toISOString())}</span>
          <b style={{ color: theme.text }}>{formatClock(new Date(replay.t).toISOString())}</b>
          <span>{formatClock(new Date(b).toISOString())}</span>
        </div>
      </div>
      <select
        value={replay.speed}
        onChange={(e) => replay.setSpeed(Number(e.target.value))}
        title={tr("timeline.speed")}
        style={{ font: "inherit", height: 28, borderRadius: 7, border: `1px solid ${theme.panelBorder}`, background: theme.panelBg, color: theme.text }}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <button style={{ ...btn, borderColor: theme.live, color: theme.live }} onClick={replay.stop} title={tr("timeline.liveHint")}>
        ● {tr("timeline.live")}
      </button>
    </div>
  );
}
