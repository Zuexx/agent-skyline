import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, OrthographicCamera } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import CameraFollow from "./city/CameraFollow.jsx";
import DemoBridge from "./city/DemoBridge.jsx";

// `?demo` exposes a tiny hook for scripted recordings (see city/DemoBridge.jsx).
const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
import City from "./city/City.jsx";
import Legend from "./ui/Legend.jsx";
import ZoneBanner from "./ui/ZoneBanner.jsx";
import TopBar from "./ui/TopBar.jsx";
import DetailPanel from "./ui/DetailPanel.jsx";
import Feed from "./ui/Feed.jsx";
import CompareSummary from "./ui/CompareSummary.jsx";
import ScopeBanner from "./ui/ScopeBanner.jsx";
import Toasts from "./ui/Toasts.jsx";
import Timeline from "./ui/Timeline.jsx";
import { useReplay } from "./lib/useReplay.js";
import { useActivity } from "./lib/useActivity.js";
import { useZones } from "./lib/useZones.js";
import { useCompare } from "./lib/useCompare.js";
import { usePrefs } from "./lib/usePrefs.js";
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
      camera.position.copy(ISO).multiplyScalar(dist);
      controls.update();
    }
    const w = Number(width) || 0;
    const d = Number(depth) || 0;
    if (w <= 0 && d <= 0) return;

    const f = ISO.clone().negate(); // view direction, camera -> origin
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
  const { prefs, resolvedTheme, setTheme, setLocale: setLocalePref, setNotify } = usePrefs();
  applyTheme(resolvedTheme);
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
  // Connect only once the city is known, so replayed commands can be resolved to files.
  const { activity: liveActivity, connected } = useActivity(cmdIndex ? "/api/events" : null, (cmd) => pathsInCommand(cmd, cmdIndex));
  // Replay swaps in the session as of a past moment; everything drawn follows `activity`,
  // while alerts and rescans keep using the live stream.
  const replay = useReplay(liveActivity.feed);
  const activity = replay.activity ?? liveActivity;
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
  // Bumped to re-frame the whole city (view switch, the overview button).
  const [fitNonce, setFitNonce] = useState(0);
  // One-off camera flight + ring (feed click, double-click on a building).
  const [focus, setFocus] = useState(null);

  const indexByPath = useMemo(() => new Map((city?.buildings ?? []).map((b, i) => [b.path, i])), [city]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null);
        setZoneMode(false);
        setScopeMode(false);
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

  // Scope check over the working tree's activity: declared globs, or inference when none.
  const warnings = useMemo(
    () => computeWarnings(activity.feed, { declared: scope.allow, known: liveIndex }),
    [activity.feed, scope.allow, liveIndex]
  );
  const warnPaths = useMemo(() => new Set([...warnings.values()].map((w) => w.path)), [warnings]);
  // Alerts come from the live stream only: replaying history must not ring again.
  const liveWarnings = useMemo(
    () => (replay.active ? computeWarnings(liveActivity.feed, { declared: scope.allow, known: liveIndex }) : warnings),
    [replay.active, liveActivity.feed, scope.allow, liveIndex, warnings]
  );
  const alerts = useMemo(() => alertsFrom(liveActivity.feed, liveWarnings), [liveActivity.feed, liveWarnings]);
  const agentName = (a) => {
    if (a.source === "watcher") return t("source.watcher");
    const name = t(`source.${a.source}`);
    return `${name.startsWith("source.") ? a.source : name} ${liveActivity.agentSeq?.[a.agent] ?? ""}`.trim();
  };
  const describeAlert = (a) => ({
    title: a.level === "block" ? t("alert.blocked") : t(`alert.${a.rule}`),
    body: a.level === "block" ? `${agentName(a)} · ${a.path ?? ""}` : `${agentName(a)} · ${t(`alert.${a.rule}Hint`)}`,
  });
  const { toasts, dismiss } = useAlerts(alerts, {
    notify: prefs.notify,
    describe: describeAlert,
    onClick: (a) => a.path && focusOn(indexByPath.get(a.path)),
  });

  const cameraPosition = useMemo(() => {
    if (!liveCity) return [1, 1, 1];
    const dist = Math.max(Number(liveCity.width) || 0, Number(liveCity.depth) || 0) * 1.2 + 30;
    return ISO.clone().multiplyScalar(dist).toArray();
  }, [liveCity]);

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
        cursor: zoneMode || scopeMode ? "crosshair" : "auto",
        background: theme.background,
        // Native widgets (scrollbars, selects) follow the theme instead of the OS default.
        colorScheme: theme.bloom ? "dark" : "light",
        scrollbarColor: `${theme.panelBorder} transparent`,
      }}
    >
      {/* Keyed by theme: materials are created with the palette's colors, so a theme switch rebuilds the scene. */}
      <Canvas key={theme.name} flat onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={[theme.background]} />
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <directionalLight position={[-6, 10, 3]} intensity={theme.keyIntensity} color={theme.keyLight} />
        <OrthographicCamera makeDefault position={cameraPosition} />
        {/* Pan + zoom; rotation clamped above ground. Grabbing the map turns follow mode off. */}
        <MapControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} onStart={() => setFollow(false)} />
        <CameraFollow target={latestTarget} enabled={follow} focus={focus} />
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
            else setSelected(i);
          }}
          onFocus={(i) => !zoneMode && !scopeMode && focusOn(i)}
          activity={activity}
          diff={compare.active ? compare.diff : null}
          ping={focus}
          locked={compare.active ? [] : zones.locked}
          allowed={compare.active ? [] : scope.allow}
          editing={zoneMode || scopeMode}
          onToggleDistrict={zoneMode ? zones.toggleDistrict : scope.toggleDistrict}
          warnPaths={compare.active ? null : warnPaths}
        />
        {/* Night only: colors pushed above 1.0 (active buildings, pulses, agents) cross the threshold. */}
        {theme.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={1.4} luminanceThreshold={1} luminanceSmoothing={0.2} />
          </EffectComposer>
        )}
      </Canvas>
      <TopBar
        repo={liveCity.repo ?? ""}
        buildingCount={city.buildings?.length ?? 0}
        districtCount={city.districts?.length ?? 0}
        connected={connected}
        replaying={replay.active}
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
          setZoneMode((z) => !z);
          setSelected(null);
        }}
        scopeMode={scopeMode}
        onToggleScopeMode={() => {
          compare.setHead(null);
          setViewId("folder");
          setZoneMode(false);
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
        locale={prefs.locale}
        onLocale={setLocalePref}
      />
      {zoneMode && <ZoneBanner locked={zones.locked} onUnlockDistrict={zones.toggleDistrict} onDone={() => setZoneMode(false)} />}
      {scopeMode && (
        <ScopeBanner allow={scope.allow} onRemoveDistrict={scope.toggleDistrict} onClear={scope.clear} onDone={() => setScopeMode(false)} />
      )}
      <Toasts toasts={toasts} describe={describeAlert} onDismiss={dismiss} onOpen={(a) => a.path && focusOn(indexByPath.get(a.path))} />
      <CompareSummary compare={compare} onClose={() => compare.setHead(null)} />
      <Legend comparing={compare.active} />
      <Timeline replay={replay} feed={liveActivity.feed} />
      <Feed feed={activity.feed} agentSeq={activity.agentSeq} warnings={warnings} onFocusPath={(p) => focusOn(indexByPath.get(p))} />
      {selectedBuilding && (
        <DetailPanel
          building={selectedBuilding}
          districtPath={districtPathFor(selectedBuilding, city.districts)}
          fileActivity={activity.files[selectedBuilding.path]}
          compare={compare}
          change={compare.diff?.get(selectedBuilding.path) ?? null}
        />
      )}
    </div>
  );
}
