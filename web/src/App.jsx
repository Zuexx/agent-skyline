import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, OrthographicCamera } from "@react-three/drei";
import CameraFollow from "./city/CameraFollow.jsx";
import CameraRig from "./city/CameraRig.jsx";
import PostFx from "./city/PostFx.jsx";
import TurnButtons from "./ui/TurnButtons.jsx";
import DemoBridge from "./city/DemoBridge.jsx";

// `?demo` exposes a tiny hook for scripted recordings (see city/DemoBridge.jsx).
const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
import City from "./city/City.jsx";
import ZoneBanner from "./ui/ZoneBanner.jsx";
import TopBar from "./ui/TopBar.jsx";
import DetailPanel from "./ui/DetailPanel.jsx";
import KpiCards from "./ui/KpiCards.jsx";
import TaskTracker from "./ui/TaskTracker.jsx";
import WorkList, { useTouchedFiles } from "./ui/WorkList.jsx";
import AgentPanel from "./ui/AgentPanel.jsx";
import { buildTasks, latestByAgent, summarize } from "./lib/tasks.js";
import CompareSummary from "./ui/CompareSummary.jsx";
import ScopeBanner from "./ui/ScopeBanner.jsx";
import Toasts from "./ui/Toasts.jsx";
import Timeline from "./ui/Timeline.jsx";
import { useReplay } from "./lib/useReplay.js";
import { useActivity } from "./lib/useActivity.js";
import { useZones } from "./lib/useZones.js";
import { useCompare } from "./lib/useCompare.js";
import { usePrefs } from "./lib/usePrefs.js";
import { useThemeList, useThemePack } from "./lib/useThemePack.js";
import { resolvePalette } from "./lib/themePack.js";
import { useScope } from "./lib/useScope.js";
import { useAlerts, requestNotify } from "./lib/useAlerts.js";
import { alertsFrom } from "./lib/alerts.js";
import { computeWarnings } from "./lib/scope.js";
import { parentDir } from "./lib/parent.js";
import { applyTheme, theme } from "./theme.js";
import { setLocale, t } from "./lib/i18n.js";
import { buildingTransform, HEIGHT_SCALE } from "./lib/geometry.js";
import { buildView } from "./lib/views.js";
import { pathIndex, pathsInCommand } from "./lib/commandPaths.js";
import { vscodeUrl } from "./lib/editor.js";
import { agentsIn, inRange, rangeFor, segmentSessions } from "./lib/sessions.js";
import { computeConflicts } from "./lib/conflicts.js";
import { depsOf, useDeps } from "./lib/deps.js";
import { rankReview, reviewItems } from "./lib/risk.js";
import { fetchWorkingDiff, useWorking } from "./lib/useWorking.js";
import { fetchFileDiff } from "./lib/useCompare.js";
import ReviewPanel from "./ui/ReviewPanel.jsx";
import TaskPanel from "./ui/TaskPanel.jsx";
import LabelLayer from "./ui/LabelLayer.jsx";
import { createLabelBus } from "./city/DistrictLabels.jsx";
import { pathsInRect, rectFrom, toggleAll } from "./lib/selection.js";

// Isometric view direction: camera sits on the (1, 1, 1) ray above the origin.
const ISO = new THREE.Vector3(1, 1, 1).normalize();

/**
 * Fit: re-center on the city and set the ortho zoom so its footprint fits the viewport.
 * Projects the centered W x D rectangle onto the camera's screen axes and takes the smaller of
 * the two required zooms (with a margin).
 */
function FitCamera({ width, depth, nonce }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  // Re-fit when the canvas settles or the window is resized, not only on data changes.
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    if (!camera.isOrthographicCamera) return; // wait for drei's makeDefault swap
    if (controls) {
      const dist = camera.position.distanceTo(controls.target);
      controls.target.set(0, 0, 0);
      camera.position.copy(camera.userData.viewDir ?? ISO).multiplyScalar(dist); // keeps a fixed camera's turn
      controls.update();
    }
    const w = Number(width) || 0;
    const d = Number(depth) || 0;
    if (w <= 0 && d <= 0) return;

    const f = (camera.userData.viewDir ?? ISO).clone().negate(); // view direction, camera -> origin
    const r = new THREE.Vector3(0, 1, 0).cross(f).normalize(); // screen right
    const u = f.clone().negate().cross(r); // screen up (camera Y axis)

    const projHalfW = (w / 2) * Math.abs(r.x) + (d / 2) * Math.abs(r.z);
    const projHalfH = (w / 2) * Math.abs(u.x) + (d / 2) * Math.abs(u.z);
    if (projHalfW <= 0 || projHalfH <= 0) return;

    // Frustum half-size at zoom 1, independent of the current zoom.
    const viewHalfW = (camera.right - camera.left) / 2;
    const viewHalfH = (camera.top - camera.bottom) / 2;
    camera.zoom = Math.min(viewHalfW / projHalfW, viewHalfH / projHalfH) * 0.85;
    camera.userData.fitZoom = camera.zoom; // CameraFollow zooms relative to this
    camera.updateProjectionMatrix();
  }, [camera, controls, width, depth, nonce, size.width, size.height]);

  return null;
}

// Middle drag: zoom doubles (or halves) every this many CSS pixels.
const MIDDLE_DRAG_PX_PER_DOUBLING = 300;

/**
 * Camera fixes on top of drei's MapControls (three-stdlib) with an orthographic camera:
 * - Middle drag is handled here, not by the controls: they zoom one fixed step per pointer-move
 *   event, so a real mouse (hundreds of events a second) zoomed wildly, toward the press point,
 *   and could throw the city off-screen. Here the zoom follows the distance dragged, around the
 *   center of the view. Chrome's middle-click autoscroll is suppressed on the canvas.
 * - The view's center (the controls' target) is kept within `maxTargetRadius` of the city's
 *   center (the origin), so zooming toward the cursor over empty space cannot lose the city.
 * - A camera that ends up inside the city cuts it off at the near plane (a straight line through
 *   the scene). Moving an orthographic camera along its view direction does not change the
 *   picture, so it is pushed back to at least `minDistance` from its target.
 */
function ControlsFixes({ minDistance, maxTargetRadius }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (!controls) return;
    controls.mouseButtons.MIDDLE = null;

    const shift = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const keepInView = () => {
      if (!camera.isOrthographicCamera) return;
      // Pull the view's center back toward the city, moving the camera with it.
      const t = controls.target;
      const r = Math.hypot(t.x, t.z);
      if (r > maxTargetRadius) {
        shift.set(t.x, 0, t.z).multiplyScalar(maxTargetRadius / r - 1);
        t.add(shift);
        camera.position.add(shift);
      }
      offset.subVectors(camera.position, t);
      if (offset.length() < minDistance) camera.position.copy(t).add(offset.setLength(minDistance));
      camera.updateMatrixWorld();
    };
    controls.addEventListener("change", keepInView);
    keepInView();

    let lastY = null;
    const onDown = (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
      controls.dispatchEvent({ type: "start" });
    };
    const onMove = (e) => {
      if (lastY == null || !camera.isOrthographicCamera) return;
      const dy = e.clientY - lastY;
      lastY = e.clientY;
      if (!dy) return;
      const zoom = camera.zoom * Math.pow(2, -dy / MIDDLE_DRAG_PX_PER_DOUBLING);
      camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, zoom));
      camera.updateProjectionMatrix();
      controls.dispatchEvent({ type: "change" });
    };
    const onUp = (e) => {
      if (lastY == null || e.button !== 1) return;
      lastY = null;
      el.releasePointerCapture?.(e.pointerId);
      controls.dispatchEvent({ type: "end" });
    };
    const noAutoscroll = (e) => e.button === 1 && e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("mousedown", noAutoscroll);
    return () => {
      controls.removeEventListener("change", keepInView);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("mousedown", noAutoscroll);
    };
  }, [camera, controls, el, minDistance, maxTargetRadius]);
  return null;
}

/**
 * Select mode support inside the canvas: frees the left mouse button from panning (right-drag
 * rotation and wheel zoom keep working), and publishes a world -> screen projection for the box
 * selection drawn over the canvas.
 */
function PickSupport({ enabled, projRef }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    if (!controls?.mouseButtons) return;
    controls.mouseButtons = { ...controls.mouseButtons, LEFT: enabled ? null : THREE.MOUSE.PAN };
  }, [controls, enabled]);
  projRef.current = (p) => {
    v.set(p[0], p[1], p[2]).project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
  };
  return null;
}

// Deepest district containing the file: longest district path that is an
// ancestor of (or equal to) the file's parent directory.
function districtPathFor(building, districts = []) {
  const dir = parentDir(building.path);
  let best = "";
  for (const d of districts) {
    if ((dir === d.path || dir.startsWith(d.path + "/")) && d.path.length > best.length) best = d.path;
  }
  return best;
}

function Status({ children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.background,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 15,
      }}
    >
      {children}
    </div>
  );
}

export default function App() {
  // Preferences first: theme and language must be applied before anything renders this pass.
  const { prefs, resolvedTheme, setTheme, setPack, setLocale: setLocalePref, setNotify } = usePrefs();
  // The theme pack's palette for night or day (a pack with one look ignores the setting).
  const { pack, error: packError } = useThemePack(prefs.pack);
  const themePacks = useThemeList();
  const { palette, variant } = resolvePalette(pack, resolvedTheme);
  applyTheme(palette, `${pack.id}:${variant}`);
  // Sprite themes: a fixed camera that turns in steps, and a building look (city/looks.js).
  const fixedCamera = pack.camera?.mode === "fixed";
  const lookStyle = pack.renderer === "sprites" ? (pack.buildings?.style ?? "model") : null;
  const [facing, setFacing] = useState(Math.PI / 4); // camera azimuth; starts on the iso diagonal
  const turnRef = useRef(null);
  setLocale(prefs.locale);

  // The working tree's city (what the agent is editing right now).
  const [liveCity, setLiveCity] = useState(null);
  const [error, setError] = useState(null);
  const compare = useCompare();
  // What is drawn: the compared branch's city while comparing, otherwise the working tree.
  const city = compare.active ? compare.city : liveCity;

  // Index into city.buildings of the selected building (null = none).
  const [selected, setSelected] = useState(null);
  // Index of the working tree's paths, so Bash commands that name files light those buildings up.
  const cmdIndex = useMemo(() => (liveCity ? pathIndex(liveCity.buildings.map((b) => b.path)) : null), [liveCity]);
  // Which stretch of the log the city shows: the latest working session by default (a gap of two
  // quiet hours starts a new one), today, a past session, or everything. See lib/sessions.js.
  const [rangeSel, setRangeSel] = useState({ kind: "recent" });
  const [range, setRange] = useState({ since: Infinity, until: null, agent: null }); // nothing until events arrive
  // Optionally just one agent's events (agent key), within that range.
  const [agentSel, setAgentSel] = useState(null);
  // Connect only once the city is known, so replayed commands can be resolved to files.
  const {
    activity: liveActivity,
    connected,
    events: rawEvents,
    version: eventsVersion,
    writes: writeCount,
  } = useActivity(cmdIndex ? "/api/events" : null, (cmd) => pathsInCommand(cmd, cmdIndex), range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => segmentSessions(rawEvents), [eventsVersion]);
  useEffect(() => {
    const next = { ...rangeFor(rangeSel, sessions, Date.now()), agent: agentSel };
    setRange((prev) => (prev.since === next.since && prev.until === next.until && prev.agent === next.agent ? prev : next));
  }, [rangeSel, sessions, agentSel]);
  // Agents in the time range, numbered once for the whole range ("Claude 2" stays "Claude 2" when
  // the view is narrowed to it). A selected agent absent from a new range is dropped.
  const agents = useMemo(
    () => agentsIn(rawEvents, { since: range.since, until: range.until }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsVersion, range.since, range.until]
  );
  const agentSeq = useMemo(() => Object.fromEntries(agents.map((a) => [a.key, a.n])), [agents]);
  useEffect(() => {
    if (agentSel != null && agents.length && !agents.some((a) => a.key === agentSel)) setAgentSel(null);
  }, [agents, agentSel]);
  // Replay swaps in the session as of a past moment; everything drawn follows `activity`,
  // while alerts and rescans keep using the live stream.
  const replay = useReplay(liveActivity.feed);
  const activity = replay.activity ?? liveActivity;
  // A replay belongs to the range it was started in.
  useEffect(() => {
    if (replay.active) replay.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);
  const viewingPast = range.until != null; // a closed past session: live events are not shown
  // How files are grouped into districts: folder / role / touched / diff (see lib/views.js).
  const [viewId, setViewId] = useState("folder");
  const zones = useZones();
  // In zone mode clicks lock/unlock districts instead of selecting buildings; in scope mode they
  // add or remove districts from the declared task scope.
  const [zoneMode, setZoneMode] = useState(false);
  const scope = useScope();
  const [scopeMode, setScopeMode] = useState(false);
  // Follow mode: the camera glides to wherever the latest event happened. Off by default, so the
  // page opens on the whole city.
  const [follow, setFollow] = useState(false);
  // District signs: chosen and positioned by the scene, drawn by an overlay (see DistrictLabels.jsx).
  const labelBus = useMemo(createLabelBus, []);
  // Select mode: drag a box (or click buildings) to pick files, then turn them into a task.
  const [pickMode, setPickMode] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { start, end } in client pixels while box-selecting
  const dragRef = useRef(null);
  const projRef = useRef(null);
  const justDragged = useRef(false); // the click that ends a box drag must not toggle a building
  // Bumped to re-frame the whole city (view switch, the overview button).
  const [fitNonce, setFitNonce] = useState(0);
  // One-off camera flight + ring (feed click, double-click on a building).
  const [focus, setFocus] = useState(null);

  const indexByPath = useMemo(() => new Map((city?.buildings ?? []).map((b, i) => [b.path, i])), [city]);
  // Who uses what: in the compared branch while comparing, else in the working tree (refetched
  // after a rescan, which replaces liveCity).
  const depIndex = useDeps(liveCity, compare.active ? compare.head : null);
  const selectedPath = selected != null ? city?.buildings?.[selected]?.path : null;
  const selectedDeps = useMemo(() => (selectedPath && depIndex ? depsOf(depIndex, selectedPath) : null), [selectedPath, depIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null);
        setZoneMode(false);
        setScopeMode(false);
        setPickMode(false);
        dragRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/city")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => !cancelled && setLiveCity(data))
      .catch((err) => !cancelled && setError(err?.message || String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Entering or leaving a comparison swaps the whole building set: clear the selection, offer the
  // diff grouping while comparing, and fall back to folders when it goes away.
  useEffect(() => {
    setSelected(null);
    setFitNonce((n) => n + 1);
    if (!compare.active) setViewId((v) => (v === "diff" ? "folder" : v));
  }, [compare.active, compare.head, compare.base]);

  // Grouped views re-lay out only when a file changes group, not on every event.
  const touchedKey = useMemo(() => {
    if (viewId !== "touched") return "";
    return Object.entries(activity.files)
      .map(([p, f]) => p + (f.writes > 0 || f.blocked > 0 ? ":w" : f.reads > 0 ? ":r" : ""))
      .sort()
      .join("|");
  }, [viewId, activity.files]);
  const view = useMemo(
    () => (city ? buildView(city, viewId, { files: activity.files, diff: compare.diff }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [city, viewId, touchedKey, compare.diff]
  );

  // A file the agent created is not a building yet: the city was scanned before it existed.
  // When activity names repo paths the working tree city does not know, rescan (debounced, once
  // per distinct set, so a path that never shows up cannot cause a refetch loop).
  const liveIndex = useMemo(() => new Set((liveCity?.buildings ?? []).map((b) => b.path)), [liveCity]);
  const unknownKey = useMemo(
    () =>
      Object.keys(liveActivity.files)
        .filter((p) => !liveIndex.has(p) && !p.startsWith("/") && !/^[a-z]:\//i.test(p))
        .sort()
        .join("|"),
    [liveActivity.files, liveIndex]
  );
  const rescanned = useRef(new Set());
  useEffect(() => {
    if (!unknownKey || rescanned.current.has(unknownKey)) return undefined;
    rescanned.current.add(unknownKey);
    const timer = setTimeout(() => {
      fetch("/api/city?rescan=1")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          if (!compare.active) setSelected(null); // building indexes change with the file set
          setLiveCity(data);
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [unknownKey, compare.active]);

  // Every agent's events in the time range (newest first), whatever the agent filter shows:
  // conflicts need both agents, and alerts must ring for any agent. Replay never touches it.
  const allFeed = useMemo(
    () => rawEvents.filter((ev) => inRange(ev, { since: range.since, until: range.until })).slice(-2000).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsVersion, range.since, range.until]
  );
  const conflicts = useMemo(() => computeConflicts(allFeed), [allFeed]);
  // Scope check over what is shown (declared globs, or inference when none), plus conflicts.
  const warnings = useMemo(
    () => new Map([...computeWarnings(activity.feed, { declared: scope.allow, known: liveIndex }), ...conflicts]),
    [activity.feed, scope.allow, liveIndex, conflicts]
  );
  const warnPaths = useMemo(() => new Set([...warnings.values()].map((w) => w.path)), [warnings]);
  // Alerts come from the live stream of every agent: neither a replay nor the agent filter mutes them.
  const alertWarnings = useMemo(
    () => new Map([...computeWarnings(allFeed, { declared: scope.allow, known: liveIndex }), ...conflicts]),
    [allFeed, scope.allow, liveIndex, conflicts]
  );
  const alerts = useMemo(() => alertsFrom(allFeed, alertWarnings), [allFeed, alertWarnings]);

  // Tasks and their stages for every agent in the range (lib/tasks.js), the agent whose task the
  // tracker and the agent panel show, and the bottom-right list's tab.
  const tasks = useMemo(() => buildTasks(allFeed), [allFeed]);
  const latestTasks = useMemo(() => latestByAgent(tasks), [tasks]);
  const [agentFocus, setAgentFocus] = useState(null);
  const [listTab, setListTab] = useState("feed");
  const trackedTask = useMemo(() => {
    if (agentFocus && latestTasks.has(agentFocus)) return latestTasks.get(agentFocus);
    let newest = null;
    for (const task of latestTasks.values()) if (!newest || task.lastTs > newest.lastTs) newest = task;
    return newest;
  }, [agentFocus, latestTasks]);
  // Blocked writes and warnings, newest first, for the list's "blocked" tab.
  const issues = useMemo(() => {
    const out = [];
    for (const task of tasks) for (const b of task.blocked) out.push({ kind: "blocked", ...b });
    for (const w of alertWarnings.values()) if (w.path) out.push({ kind: "warning", rule: w.rule, path: w.path, ts: Date.parse(w.ts) || 0 });
    return out.sort((a, b) => b.ts - a.ts);
  }, [tasks, alertWarnings]);

  // Uncommitted changes in the working tree, refreshed after every write the agents report.
  const working = useWorking(writeCount);
  const touchedFiles = useTouchedFiles(activity.files);

  // The KPI cards: uncommitted changes from git when known (they include line counts), else the
  // files the agents wrote in the range.
  const kpi = useMemo(() => {
    const s = summarize(tasks, Date.now());
    const blocked = issues.filter((i) => i.kind === "blocked").length;
    const base = { active: s.active, written: s.written, added: null, removed: null, blocked, warned: issues.length - blocked, lastCheck: s.lastCheck };
    if (!working) return base;
    let added = 0;
    let removed = 0;
    for (const f of working.values()) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
    }
    return { ...base, written: working.size, added, removed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, issues, working, eventsVersion]);

  // What the detail panel's diff shows: the compared branch's change to the selected file, or its
  // uncommitted change. Memoized so a re-render does not refetch a diff that is still loading.
  const workingChange = !compare.active && selectedPath ? (working?.get(selectedPath) ?? null) : null;
  const diffSource = useMemo(() => {
    if (!selectedPath) return null;
    if (compare.active) {
      return {
        key: `${compare.base}...${compare.head}`,
        label: t("detail.diff", { base: compare.base }),
        change: compare.diff?.get(selectedPath) ?? null,
        load: () => fetchFileDiff(compare.base, compare.head, selectedPath),
        emptyText: t("detail.unchanged"),
      };
    }
    if (!workingChange) return null;
    return {
      key: `working:${workingChange.status}:${workingChange.added}:${workingChange.removed}`,
      label: t("detail.working"),
      change: workingChange,
      load: () => fetchWorkingDiff(selectedPath),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, compare.active, compare.base, compare.head, compare.diff, workingChange, prefs.locale]);

  // Review list: the compared branch's changes, or this session's writes, riskiest first.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [churn, setChurn] = useState(null);
  useEffect(() => {
    fetch("/api/churn")
      .then((res) => (res.ok ? res.json() : null))
      .then((c) => c && setChurn(c.commits))
      .catch(() => {});
  }, []);
  const ranked = useMemo(() => {
    const warned = new Set(warnPaths);
    for (const [p, f] of Object.entries(activity.files)) if (f.blocked > 0) warned.add(p);
    const items = reviewItems({ diff: compare.active ? compare.diff : null, files: activity.files, working });
    return rankReview(items, { churn, deps: depIndex, warned: compare.active ? new Set() : warned });
  }, [compare.active, compare.diff, activity.files, churn, depIndex, warnPaths, working]);
  const agentName = (a) => {
    if (a.source === "watcher") return t("source.watcher");
    const name = t(`source.${a.source}`);
    return `${name.startsWith("source.") ? a.source : name} ${agentSeq[a.agent] ?? ""}`.trim();
  };
  const describeAlert = (a) => {
    if (a.level === "done") {
      const s = a.summary;
      return {
        title: t("alert.done", { who: agentName(a) }),
        body: s.written.length
          ? t("alert.doneBody", { n: s.written.length, warned: s.warned, blocked: s.blocked })
          : s.blocked
            ? t("alert.doneBlockedOnly", { blocked: s.blocked })
            : t("alert.doneNothing"),
      };
    }
    if (a.level === "block") return { title: t("alert.blocked"), body: `${agentName(a)} · ${a.path ?? ""}` };
    if (a.rule === "conflict") {
      return { title: t("alert.conflict"), body: t("alert.conflictBody", { who: agentName(a), other: agentName({ agent: a.other, source: a.otherSource }) }) };
    }
    return { title: t(`alert.${a.rule}`), body: `${agentName(a)} · ${t(`alert.${a.rule}Hint`)}` };
  };
  // A finished turn opens the review list; anything else flies to its building.
  const openAlert = (a) => {
    if (a.level === "done") setReviewOpen(true);
    else if (a.path) focusOn(indexByPath.get(a.path));
  };
  const { toasts, dismiss } = useAlerts(alerts, { notify: prefs.notify, describe: describeAlert, onClick: openAlert });

  const cameraPosition = useMemo(() => {
    if (!liveCity) return [1, 1, 1];
    const dist = Math.max(Number(liveCity.width) || 0, Number(liveCity.depth) || 0) * 1.2 + 30;
    return ISO.clone().multiplyScalar(dist).toArray();
  }, [liveCity]);
  // The default far plane (2,000) clipped big cities: VS Code is 1,880 deep and the camera sits
  // ~2,300 away. Reach past the whole city from any angle the controls allow.
  const cameraFar = useMemo(() => {
    const w = Math.max(Number(liveCity?.width) || 0, Number(compare.city?.width) || 0);
    const d = Math.max(Number(liveCity?.depth) || 0, Number(compare.city?.depth) || 0);
    return Math.max(2000, (Math.max(w, d) * 1.2 + 30 + Math.hypot(w, d)) * 2);
  }, [liveCity, compare.city]);

  // World position (city centered at the origin) of building i in the current view.
  const worldOf = (i) => {
    const { position } = buildingTransform(view.buildings[i], {}, HEIGHT_SCALE);
    return [position[0] - view.width / 2, 0, position[2] - view.depth / 2];
  };

  // Newest event that names a known building, for follow mode.
  const latestTarget = useMemo(() => {
    if (!view) return null;
    for (const ev of activity.feed) {
      const i = indexByPath.get(ev.paths?.[0] ?? ev.readPaths?.[0]);
      if (i != null) return worldOf(i);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.feed, view, indexByPath]);

  // Screen point of a building's middle, for the box selection (null when behind the camera).
  const screenOfPath = (p) => {
    const i = indexByPath.get(p);
    if (i == null || !projRef.current) return null;
    const { position } = buildingTransform(view.buildings[i], {}, HEIGHT_SCALE);
    return projRef.current([position[0] - view.width / 2, position[1], position[2] - view.depth / 2]);
  };
  // The drag lives in a ref (events can outrun renders); the state copy only draws the box.
  const boxDown = (e) => {
    if (!pickMode || e.button !== 0 || e.target.tagName !== "CANVAS") return;
    dragRef.current = { start: { x: e.clientX, y: e.clientY }, end: { x: e.clientX, y: e.clientY } };
    setDrag(dragRef.current);
  };
  const boxMove = (e) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, end: { x: e.clientX, y: e.clientY } };
    setDrag(dragRef.current);
  };
  const boxUp = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    const rect = rectFrom(d.start, { x: e.clientX, y: e.clientY });
    if (rect.right - rect.left < 6 && rect.bottom - rect.top < 6) return; // a click, not a box
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 80);
    const hits = pathsInRect(view.buildings.map((b) => b.path), screenOfPath, rect);
    setPicked((s) => toggleAll(s, hits));
  };

  // Select an agent: its task in the tracker, its panel on the right, the camera on its last file.
  const pickAgent = (key) => {
    setAgentFocus(key);
    setSelected(null);
    const i = indexByPath.get(latestTasks.get(key)?.lastPath);
    if (i != null && view) {
      setFollow(false);
      setFocus({ target: worldOf(i), path: view.buildings[i].path, nonce: Date.now() });
    }
  };

  const focusOn = (i) => {
    if (i == null || !view) return;
    setSelected(i);
    setFollow(false);
    setFocus({ target: worldOf(i), path: view.buildings[i].path, nonce: Date.now() });
  };

  if (error) return <Status>{t("app.loadError", { error })}</Status>;
  if (!liveCity || !view) return <Status>{t("app.loading")}</Status>;

  const selectedBuilding = selected != null ? city.buildings?.[selected] : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        cursor: zoneMode || scopeMode || pickMode ? "crosshair" : "auto",
        userSelect: drag ? "none" : "auto",
        background: theme.background,
        // Native widgets (scrollbars, selects) follow the theme instead of the OS default.
        colorScheme: theme.bloom ? "dark" : "light",
        scrollbarColor: `${theme.panelBorder} transparent`,
      }}
      onPointerDown={boxDown}
      onPointerMove={boxMove}
      onPointerUp={boxUp}
    >
      {/* Keyed by theme: materials are created with the palette's colors, so a theme switch rebuilds the scene. */}
      <Canvas key={theme.name} flat onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={[theme.background]} />
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <directionalLight position={[-6, 10, 3]} intensity={theme.keyIntensity} color={theme.keyLight} />
        <OrthographicCamera makeDefault position={cameraPosition} far={cameraFar} />
        {/* Pan + zoom; rotation clamped above ground. Grabbing the map turns follow mode off.
            The wheel zooms toward the cursor (like a map), about 8% per notch. */}
        <MapControls makeDefault zoomToCursor zoomSpeed={1.6} maxPolarAngle={Math.PI / 2 - 0.05} onStart={() => setFollow(false)} />
        <ControlsFixes
          minDistance={new THREE.Vector3(...cameraPosition).length()}
          maxTargetRadius={Math.hypot(Number(view.width) || 0, Number(view.depth) || 0) / 2 || Infinity}
        />
        <CameraFollow target={latestTarget} enabled={follow} focus={focus} />
        <CameraRig fixed={fixedCamera} stepDeg={pack.camera?.rotateStepDeg ?? 90} turnRef={turnRef} onTurned={setFacing} />
        <PickSupport enabled={pickMode} projRef={projRef} />
        <FitCamera width={view.width} depth={view.depth} nonce={fitNonce} />
        {DEMO && (
          <DemoBridge
            worldOf={(p) => {
              const i = indexByPath.get(p);
              if (i == null) return null;
              const { position, scale } = buildingTransform(view.buildings[i], {}, HEIGHT_SCALE);
              return [position[0] - view.width / 2, position[1] + scale[1] / 2, position[2] - view.depth / 2];
            }}
          />
        )}
        <City
          city={view}
          selected={selected}
          onSelect={(i) => {
            // A building click in zone or scope mode means its parent district.
            const district = districtPathFor(city.buildings[i], city.districts);
            if (zoneMode) zones.toggleDistrict(district);
            else if (scopeMode) scope.toggleDistrict(district);
            else if (pickMode) !justDragged.current && setPicked((s) => toggleAll(s, [city.buildings[i].path]));
            else setSelected(i);
          }}
          onFocus={(i) => !zoneMode && !scopeMode && !pickMode && focusOn(i)}
          activity={activity}
          diff={compare.active ? compare.diff : null}
          ping={focus}
          locked={compare.active ? [] : zones.locked}
          allowed={compare.active ? [] : scope.allow}
          editing={zoneMode || scopeMode}
          onToggleDistrict={zoneMode ? zones.toggleDistrict : scope.toggleDistrict}
          warnPaths={compare.active ? null : warnPaths}
          roads={selectedDeps ? { path: selectedPath, deps: selectedDeps } : null}
          picked={picked}
          labelBus={labelBus}
          selectedAgent={agentFocus}
          onSelectAgent={pickAgent}
          lookStyle={lookStyle}
          facing={facing}
        />
        <PostFx post={pack.post ?? null} />
      </Canvas>
      <LabelLayer bus={labelBus} grouped={view.grouped} />
      {fixedCamera && <TurnButtons onTurn={(dir) => turnRef.current?.(dir)} />}
      <TopBar
        repo={liveCity.repo ?? ""}
        buildingCount={city.buildings?.length ?? 0}
        districtCount={city.districts?.length ?? 0}
        connected={connected}
        replaying={replay.active}
        sessions={sessions}
        rangeSel={rangeSel}
        onRange={setRangeSel}
        agents={agents}
        agentSel={agentSel}
        onAgent={setAgentSel}
        agentLabel={(a) => agentName({ agent: a.key, source: a.source })}
        viewingPast={viewingPast}
        follow={follow}
        onToggleFollow={() => setFollow((f) => !f)}
        onFit={() => {
          setFollow(false);
          setFitNonce((n) => n + 1);
        }}
        viewId={viewId}
        onChangeView={(id) => {
          setViewId(id);
          setFollow(false);
          setFitNonce((n) => n + 1);
          if (id !== "folder") setZoneMode(false); // zones are folders; locking needs the folder view
        }}
        compare={compare}
        zoneMode={zoneMode}
        onToggleZoneMode={() => {
          compare.setHead(null); // zones apply to the working tree, not to another branch
          setViewId("folder");
          setScopeMode(false);
          setPickMode(false);
          setZoneMode((z) => !z);
          setSelected(null);
        }}
        scopeMode={scopeMode}
        onToggleScopeMode={() => {
          compare.setHead(null);
          setViewId("folder");
          setZoneMode(false);
          setPickMode(false);
          setScopeMode((s) => !s);
          setSelected(null);
        }}
        scopeCount={scope.allow.length}
        notify={prefs.notify}
        onToggleNotify={async () => {
          if (prefs.notify) return setNotify(false);
          // Permission must be requested from a click. If the browser refuses, the bell stays off;
          // toasts inside the page keep working either way.
          if (await requestNotify()) setNotify(true);
        }}
        lockedCount={zones.locked.length}
        zonesStatus={zones.status}
        zonesError={zones.error}
        themePref={prefs.theme}
        onTheme={setTheme}
        packs={themePacks}
        packId={prefs.pack}
        onPack={setPack}
        packError={packError}
        locale={prefs.locale}
        onLocale={setLocalePref}
        pickMode={pickMode}
        pickCount={picked.size}
        onTogglePickMode={() => {
          setZoneMode(false);
          setScopeMode(false);
          setSelected(null);
          setPickMode((m) => !m);
        }}
        reviewOpen={reviewOpen}
        reviewCount={ranked.length}
        onToggleReview={() => setReviewOpen((o) => !o)}
      />
      {zoneMode && <ZoneBanner locked={zones.locked} onUnlockDistrict={zones.toggleDistrict} onDone={() => setZoneMode(false)} />}
      {scopeMode && (
        <ScopeBanner
          allow={scope.allow}
          onRemoveDistrict={scope.toggleDistrict}
          onRemoveGlob={(g) => scope.set(scope.allow.filter((x) => x !== g))}
          onClear={scope.clear}
          onDone={() => setScopeMode(false)}
        />
      )}
      <Toasts toasts={toasts} describe={describeAlert} onDismiss={dismiss} onOpen={openAlert} />
      <CompareSummary compare={compare} onClose={() => compare.setHead(null)} />
      {!compare.active && (
        <KpiCards
          kpi={kpi}
          onActive={() => setListTab("agents")}
          onWritten={() => setReviewOpen(true)}
          onIssues={() => setListTab("blocked")}
        />
      )}
      <Timeline replay={replay} feed={liveActivity.feed} />
      {reviewOpen ? (
        <ReviewPanel
          ranked={ranked}
          scopeKey={compare.active ? `${compare.base}...${compare.head}` : "live"}
          onFocusPath={(p) => focusOn(indexByPath.get(p))}
          onClose={() => setReviewOpen(false)}
        />
      ) : (
        <TaskTracker
          tasks={latestTasks}
          task={trackedTask}
          agentName={(task) => agentName({ agent: task.agent, source: task.source })}
          onPickAgent={pickAgent}
          onFocusPath={(p) => focusOn(indexByPath.get(p))}
        />
      )}
      <WorkList
        tab={listTab}
        onTab={setListTab}
        feedProps={{ feed: activity.feed, agentSeq, warnings, onFocusPath: (p) => focusOn(indexByPath.get(p)) }}
        tasks={latestTasks}
        files={touchedFiles}
        issues={issues}
        comparing={compare.active}
        agentName={(task) => agentName({ agent: task.agent, source: task.source })}
        selectedAgent={agentFocus}
        onPickAgent={pickAgent}
        onFocusPath={(p) => focusOn(indexByPath.get(p))}
      />
      {drag && (
        <div
          style={{
            position: "fixed",
            zIndex: 90,
            pointerEvents: "none",
            left: Math.min(drag.start.x, drag.end.x),
            top: Math.min(drag.start.y, drag.end.y),
            width: Math.abs(drag.end.x - drag.start.x),
            height: Math.abs(drag.end.y - drag.start.y),
            border: `1px dashed ${theme.read}`,
            background: `${theme.read}22`,
          }}
        />
      )}
      {picked.size > 0 && (
        <TaskPanel
          paths={[...picked]}
          onRemove={(p) => setPicked((s) => toggleAll(s, [p]))}
          onClear={() => {
            setPicked(new Set());
            setPickMode(false);
          }}
          onSetScope={(paths) => scope.set(paths)}
          onFocusPath={(p) => focusOn(indexByPath.get(p))}
        />
      )}
      {!selectedBuilding && picked.size === 0 && agentFocus && latestTasks.has(agentFocus) && (
        <AgentPanel
          task={latestTasks.get(agentFocus)}
          name={agentName({ agent: agentFocus, source: latestTasks.get(agentFocus).source })}
          onFocusPath={(p) => focusOn(indexByPath.get(p))}
          onClose={() => setAgentFocus(null)}
        />
      )}
      {selectedBuilding && picked.size === 0 && (
        <DetailPanel
          building={selectedBuilding}
          districtPath={districtPathFor(selectedBuilding, city.districts)}
          fileActivity={activity.files[selectedBuilding.path]}
          diffSource={diffSource}
          openUrl={liveIndex.has(selectedBuilding.path) ? vscodeUrl(liveCity.repoPath, selectedBuilding.path) : null}
          deps={selectedDeps}
          onFocusPath={(p) => focusOn(indexByPath.get(p))}
        />
      )}
    </div>
  );
}
