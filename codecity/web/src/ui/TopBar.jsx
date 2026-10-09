import { theme } from "../theme.js";
import { VIEWS } from "../lib/views.js";
import { LOCALES, t } from "../lib/i18n.js";
import Icon from "./Icon.jsx";

const THEME_ORDER = ["auto", "night", "day"];
const THEME_ICON = { auto: "monitor", night: "moon", day: "sun" };

// Square icon button with a tooltip; `on` lights it in the accent color; `badge` is a small count.
function IconButton({ icon, label, onClick, on = false, accent = theme.read, badge }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      style={{
        position: "relative",
        width: 32,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        cursor: "pointer",
        border: `1px solid ${on ? accent : theme.panelBorder}`,
        background: on ? accent : "transparent",
        color: on ? "#fff" : theme.text,
      }}
    >
      <Icon name={icon} />
      {badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: theme.blocked,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Select({ value, onChange, title, children }) {
  return (
    <select
      value={value ?? ""}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      style={{
        font: "inherit",
        fontSize: 12,
        height: 30,
        padding: "0 6px",
        borderRadius: 7,
        border: `1px solid ${theme.panelBorder}`,
        background: theme.panelBg,
        color: theme.text,
        maxWidth: 220,
      }}
    >
      {children}
    </select>
  );
}

const Divider = () => <span style={{ width: 1, alignSelf: "stretch", background: theme.panelBorder, margin: "2px 2px" }} />;

// Top overlay in three parts:
// - left: what is watched and whether events are live;
// - middle: the main control, how files are grouped (kept as words: no icon says "role" or "diff");
// - right: branch comparison (a branch name is content, kept as text), then icon tools —
//   overview, follow, locked zones, theme, language — each with a tooltip.
export default function TopBar({
  repo,
  buildingCount,
  districtCount,
  connected = false,
  follow = false,
  onToggleFollow,
  onFit,
  viewId = "folder",
  onChangeView,
  compare,
  zoneMode = false,
  onToggleZoneMode,
  lockedCount = 0,
  zonesStatus,
  zonesError,
  themePref = "auto",
  onTheme,
  locale,
  onLocale,
}) {
  const views = VIEWS.filter((v) => !v.needsCompare || compare?.active);
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(themePref) + 1) % THEME_ORDER.length];
  const nextLocale = LOCALES[(LOCALES.findIndex((l) => l.id === locale) + 1) % LOCALES.length];
  const localeLabel = { "zh-TW": "繁", en: "EN" }[locale] ?? locale;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        right: 12,
        zIndex: 100,
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 12px",
        alignItems: "center",
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 10,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        padding: "7px 12px",
        backdropFilter: "blur(6px)",
      }}
    >
      {/* Left: identity and status */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 260px" }}>
        <span style={{ fontWeight: 700, letterSpacing: 0.3 }}>CodeCity</span>
        <span
          title={`${t("top.watching", { repo })} · ${t("top.counts", { files: buildingCount, dirs: districtCount })}`}
          style={{ color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
        >
          {repo.split(/[\\/]/).filter(Boolean).pop()} · {t("top.counts", { files: buildingCount, dirs: districtCount })}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} title={t("top.liveHint")}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? theme.live : theme.offline,
              boxShadow: connected && theme.bloom ? `0 0 8px ${theme.live}` : "none",
            }}
          />
          {connected ? t("top.live") : t("top.offline")}
        </span>
      </span>

      {/* Middle: grouping, the main control */}
      <span role="radiogroup" aria-label={t("top.groupBy")} title={t("top.groupBy")} style={{ display: "inline-flex", border: `1px solid ${theme.panelBorder}`, borderRadius: 8, overflow: "hidden" }}>
        {views.map((v) => (
          <button
            key={v.id}
            role="radio"
            aria-checked={viewId === v.id}
            title={t(`view.${v.id}Hint`)}
            onClick={() => onChangeView?.(v.id)}
            style={{
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              height: 30,
              padding: "0 14px",
              border: "none",
              cursor: "pointer",
              background: viewId === v.id ? theme.read : "transparent",
              color: viewId === v.id ? "#fff" : theme.text,
            }}
          >
            {t(`view.${v.id}`)}
          </button>
        ))}
      </span>

      {/* Right: comparison, then icon tools */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "1 1 260px", justifyContent: "flex-end", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={t("top.compareHint")}>
          <span style={{ color: theme.muted, fontSize: 12 }}>{t("top.compare")}</span>
          <Select value={compare.head ?? ""} onChange={(v) => compare.setHead(v || null)} title={t("top.compareHint")}>
            <option value="">{t("top.compareNone")}</option>
            {compare.branches
              .filter((b) => b !== compare.base)
              .map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
          </Select>
          {compare.head && (
            <>
              <span style={{ color: theme.muted }}>vs</span>
              <Select value={compare.base} onChange={compare.setBase}>
                {compare.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </>
          )}
        </span>
        <Divider />
        <IconButton icon="map" label={t("top.fitHint")} onClick={onFit} />
        <IconButton
          icon="follow"
          on={follow}
          label={t("top.followTip", { state: follow ? t("top.on") : t("top.off"), hint: t("top.followHint") })}
          onClick={onToggleFollow}
        />
        <IconButton
          icon="lock"
          on={zoneMode}
          accent={theme.blocked}
          badge={lockedCount}
          label={t("top.zonesTip", { count: lockedCount ? t("top.zonesTipCount", { n: lockedCount }) : "", hint: t("top.zonesHint") })}
          onClick={onToggleZoneMode}
        />
        <Divider />
        <IconButton
          icon={THEME_ICON[themePref] ?? "monitor"}
          label={t("top.themeTip", { name: t(`theme.${themePref}`) })}
          onClick={() => onTheme?.(nextTheme)}
        />
        <button
          onClick={() => onLocale?.(nextLocale.id)}
          title={t("top.langTip")}
          aria-label={t("top.langTip")}
          style={{
            height: 30,
            minWidth: 32,
            padding: "0 6px",
            borderRadius: 7,
            cursor: "pointer",
            border: `1px solid ${theme.panelBorder}`,
            background: "transparent",
            color: theme.text,
            font: "inherit",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {localeLabel}
        </button>
      </span>

      {(zonesStatus === "invalid" || zonesError || compare.error) && (
        <span style={{ flexBasis: "100%", color: theme.blocked, fontSize: 12 }}>
          {zonesStatus === "invalid" && <b>{t("top.zonesInvalid")} </b>}
          {zonesError && t("top.zonesError", { error: zonesError })} {compare.error}
        </span>
      )}
    </div>
  );
}
