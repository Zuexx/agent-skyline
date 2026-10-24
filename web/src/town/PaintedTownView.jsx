import { useEffect, useMemo, useRef, useState } from "react";
import { createPaintedTown } from "./paintedTown.js";
import { BIG_CHANGE, buildingModes, houseStates, townState } from "./townState.js";
import { buildingOf, townBuildings } from "./townLayout.js";
import { useNow } from "../lib/useNow.js";
import { t } from "../lib/i18n.js";

/**
 * The painted town (pack renderer "painted", specs/09–10) in place of the 3D city: fills its
 * parent, follows the page's live `activity`. The renderer is rebuilt when the pack or the variant
 * changes; agent state and construction sites are pushed in without rebuilding. `paths` are the
 * repo's files: folders the painting does not have become construction sites (townLayout.js).
 * `names`: agent key -> name tag ("Claude 1"); `prompts`: agent key -> { text, at } (its latest
 * prompt, shown in a bubble for a moment). Clicking a building calls onPickFolder(id, files)
 * (null on open ground); `folder` is the building whose sign is marked. `working` (Map path ->
 * uncommitted change), `locked` (zone globs) and `scopeAllow` (task scope globs) set what stands on
 * the houses (scaffolds, barriers, scope rings); `warnings` (lib/scope.js) and `reviewed` (Set of
 * paths ticked off in the review) raise and lower the out-of-scope marks. `mapMode` is the
 * toolbar's view (folder / role / touched / diff, spec 09 §5); `diff` the compared branch's
 * changes (Map path -> { status }) for the diff view.
 */
export default function PaintedTownView({ pack, variant, activity, agentSeq, paths = [], view = "pano", names = {}, prompts = {}, rootName = "", folder = null, onPickFolder, working = null, locked = [], scopeAllow = [], warnings = null, reviewed = null, mapMode = "folder", diff = null }) {
  const box = useRef(null);
  const renderer = useRef(null);
  const [error, setError] = useState(null);
  const now = useNow(10_000); // quiet agents go idle and leave even without new events
  const town = useMemo(() => townBuildings(paths, pack.variants[variant]?.buildings ?? [], pack.lots ?? []), [paths, pack, variant]);
  // A new folder with no lot left has no site: its activity goes to the painted folder above it.
  const buildingIds = useMemo(() => town.filter((b) => b.painted || b.lot).map((b) => b.id), [town]);
  const sites = useMemo(() => town.filter((b) => !b.painted && b.lot).map((b) => ({ id: b.id, lot: b.lot })), [town]);
  const state = useMemo(() => {
    const s = townState(activity, agentSeq, buildingIds, now, prompts, warnings);
    let houses = houseStates(buildingIds, { working, locked, allow: scopeAllow, warnings, reviewed });
    const mode = mapMode === "diff" && !diff ? "folder" : mapMode;
    const modes = buildingModes(buildingIds, paths, { files: activity?.files, diff });
    const labels = Object.fromEntries(["blocked", "failed", "scaffold", "warn", "scope"].map((k) => [k, t(`town.chip.${k}`)]));
    labels.warnHint = (n) => t("town.chip.warnHint", { n });
    labels.role = Object.fromEntries(["code", "test", "doc", "config", "asset"].map((r) => [r, t(`group.${r}`)]));
    labels.added = (n) => t("town.chip.added", { n });
    labels.deleted = (n) => t("town.chip.deleted", { n });
    if (mode === "diff") {
      // the branch's construction drawing: no agents or live events; scaffolds where it modified
      // files, the locked barriers stay (spec 09 §5)
      houses = Object.fromEntries(
        Object.entries(modes)
          .map(([id, m]) => {
            const n = m.modified + m.added;
            const level = n === 0 ? 0 : n < 3 ? 1 : n < BIG_CHANGE ? 2 : 3;
            return [id, { changes: n, level, locked: !!houses[id]?.locked, scope: false, warn: 0 }];
          })
          .filter(([, h]) => h.level || h.locked),
      );
      return { agents: [], recent: [], tests: {}, conflicts: [], houses, labels, mode, modes };
    }
    return { ...s, houses, labels, mode, modes, agents: s.agents.map((a) => ({
      ...a,
      // a subagent's name tag says whose helper it is (lib/sessions.js); prompts go to the main agent
      name: names[a.key] ?? null,
      prompt: a.parent ? null : (prompts[a.key] ?? null),
    })) };
  }, [activity, agentSeq, buildingIds, now, names, prompts, working, locked, scopeAllow, warnings, reviewed, mapMode, diff, paths]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

  useEffect(() => {
    let cancelled = false;
    let made = null;
    setError(null);
    createPaintedTown({
      container: box.current,
      pack,
      base: `/themes/${encodeURIComponent(pack.id)}/`,
      variant: pack.variants[variant] ? variant : Object.keys(pack.variants)[0],
      view,
      initialState: stateRef.current,
      initialSites: sitesRef.current,
      rootName,
    })
      .then((t) => {
        if (cancelled) return t.dispose();
        made = renderer.current = t;
        // ?debug: the renderer on window.__town, for checks over the debug port (setState, pick, ...)
        if (new URLSearchParams(location.search).has("debug")) window.__town = t;
        // whatever arrived while the pack was loading
        t.setSites(sitesRef.current);
        t.setState(stateRef.current);
        t.setSelected(folderRef.current);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      made?.dispose();
      renderer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, variant, view, rootName]);

  useEffect(() => {
    renderer.current?.setSites(sites);
  }, [sites]);

  useEffect(() => {
    renderer.current?.setState(state);
  }, [state]);

  useEffect(() => {
    renderer.current?.setSelected(folder);
  }, [folder]);

  // Which building a click lands on, and the repo files it holds.
  const onClick = (e) => {
    const id = renderer.current?.pick(e.clientX, e.clientY) ?? null;
    if (!onPickFolder) return;
    if (id == null) return onPickFolder(null, []);
    onPickFolder(id, paths.filter((p) => buildingOf(p, buildingIds) === id));
  };
  const onMove = (e) => {
    const over = renderer.current?.pick(e.clientX, e.clientY) != null;
    if (box.current) box.current.style.cursor = over ? "pointer" : "default";
  };

  return (
    <div ref={box} onClick={onClick} onPointerMove={onMove} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {error && <div style={{ position: "absolute", left: 16, bottom: 16, color: "#f88", font: "13px system-ui" }}>{error}</div>}
    </div>
  );
}
