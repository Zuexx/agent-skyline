import { useEffect, useMemo, useRef, useState } from "react";
import { createPaintedTown } from "./paintedTown.js";
import { townState } from "./townState.js";
import { buildingOf, townBuildings } from "./townLayout.js";
import { useNow } from "../lib/useNow.js";

/**
 * The painted town (pack renderer "painted", specs/09–10) in place of the 3D city: fills its
 * parent, follows the page's live `activity`. The renderer is rebuilt when the pack or the variant
 * changes; agent state and construction sites are pushed in without rebuilding. `paths` are the
 * repo's files: folders the painting does not have become construction sites (townLayout.js).
 * `names`: agent key -> name tag ("Claude 1"); `prompts`: agent key -> { text, at } (its latest
 * prompt, shown in a bubble for a moment). Clicking a building calls onPickFolder(id, files)
 * (null on open ground); `folder` is the building whose sign is marked.
 */
export default function PaintedTownView({ pack, variant, activity, agentSeq, paths = [], view = "pano", names = {}, prompts = {}, rootName = "", folder = null, onPickFolder }) {
  const box = useRef(null);
  const renderer = useRef(null);
  const [error, setError] = useState(null);
  const now = useNow(10_000); // quiet agents go idle even without new events
  const town = useMemo(() => townBuildings(paths, pack.variants[variant]?.buildings ?? [], pack.lots ?? []), [paths, pack, variant]);
  // A new folder with no lot left has no site: its activity goes to the painted folder above it.
  const buildingIds = useMemo(() => town.filter((b) => b.painted || b.lot).map((b) => b.id), [town]);
  const sites = useMemo(() => town.filter((b) => !b.painted && b.lot).map((b) => ({ id: b.id, lot: b.lot })), [town]);
  const state = useMemo(() => {
    const s = townState(activity, agentSeq, buildingIds, now);
    return { ...s, agents: s.agents.map((a) => ({ ...a, name: names[a.key] ?? null, prompt: prompts[a.key] ?? null })) };
  }, [activity, agentSeq, buildingIds, now, names, prompts]);
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
