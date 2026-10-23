import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Top-left cards under the top bar, WareTrack style: the four numbers that answer "how is the work
// going" at a glance. Each card is a button that opens where its number comes from.
// `kpi` = { active, written, added, removed, blocked, warned, lastCheck: { outcome } | null }.
export default function KpiCards({ kpi, onActive, onWritten, onIssues }) {
  const check = kpi.lastCheck;
  const checkText = !check ? t("kpi.none") : t(`kpi.${check.outcome ?? "unknown"}`);
  const checkColor = check?.outcome === "passed" ? theme.added : check?.outcome === "failed" ? theme.blocked : theme.muted;
  const issues = kpi.blocked + kpi.warned;
  return (
    <div style={{ position: "fixed", top: 70, left: 12, zIndex: 100, display: "flex", gap: 8, fontFamily: "system-ui, sans-serif" }}>
      <Card label={t("kpi.active")} hint={t("kpi.activeHint")} onClick={onActive} value={kpi.active} color={kpi.active ? theme.live : theme.muted} />
      <Card
        label={t("kpi.written")}
        hint={t("kpi.writtenHint")}
        onClick={onWritten}
        value={kpi.written}
        sub={
          kpi.added != null && (
            <>
              <span style={{ color: theme.added }}>+{kpi.added}</span> <span style={{ color: theme.deleted }}>−{kpi.removed}</span>
            </>
          )
        }
      />
      <Card
        label={t("kpi.issues")}
        hint={t("kpi.issuesHint")}
        onClick={onIssues}
        value={issues}
        color={issues ? theme.blocked : theme.muted}
        sub={t("kpi.issuesSub", { blocked: kpi.blocked, warned: kpi.warned })}
      />
      <Card label={t("kpi.check")} hint={check?.command ? `${t("kpi.checkHint")}\n${check.command}` : t("kpi.checkHint")} value={checkText} color={checkColor} small />
    </div>
  );
}

function Card({ label, hint, value, sub = null, color = theme.text, small = false, onClick = null }) {
  return (
    <button
      onClick={onClick ?? undefined}
      title={hint}
      style={{
        font: "inherit",
        textAlign: "left",
        minWidth: 112,
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${theme.panelBorder}`,
        background: theme.panelBg,
        color: theme.text,
        backdropFilter: "blur(6px)",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 11, color: theme.muted, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: small ? 16 : 22, fontWeight: 700, lineHeight: 1.25, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.muted, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{sub}</div>}
    </button>
  );
}
