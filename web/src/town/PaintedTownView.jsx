import { useEffect, useMemo, useRef, useState } from "react";
import { createPaintedTown } from "./paintedTown.js";
import { townState } from "./townState.js";
import { townBuildings } from "./townLayout.js";
import { useNow } from "../lib/useNow.js";

/**
 * The painted town (pack renderer "painted", specs/09–10) in place of the 3D city: fills its
 * parent, follows the page's live `activity`. The renderer is rebuilt when the pack or the variant
 * changes; agent state and construction sites are pushed in without rebuilding. `paths` are the
 * repo's files: folders the painting does not have become construction sites (townLayout.js).
 */
export default function PaintedTownView({ pack, variant, activity, agentSeq, paths = [], view = "pano" }) {
  const box = useRef(null);
  const renderer = useRef(null);
  const [error, setError] = useState(null);
  const now = useNow(10_000); // quiet agents go idle even without new events
  const town = useMemo(() => townBuildings(paths, pack.variants[variant]?.buildings ?? [], pack.lots ?? []), [paths, pack, variant]);
  const buildingIds = useMemo(() => town.map((b) => b.id), [town]);
  const sites = useMemo(() => town.filter((b) => !b.painted).map((b) => ({ id: b.id, lot: b.lot })), [town]);
  const state = useMemo(() => townState(activity, agentSeq, buildingIds, now), [activity, agentSeq, buildingIds, now]);
  const stateRef = useRef(state);
  stateRef.current = state;
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
    })
      .then((t) => {
        if (cancelled) return t.dispose();
        made = renderer.current = t;
        // whatever arrived while the pack was loading
        t.setSites(sitesRef.current);
        t.setState(stateRef.current);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      made?.dispose();
      renderer.current = null;
    };
  }, [pack, variant, view]);

  useEffect(() => {
    renderer.current?.setSites(sites);
  }, [sites]);

  useEffect(() => {
    renderer.current?.setState(state);
  }, [state]);

  return (
    <div ref={box} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {error && <div style={{ position: "absolute", left: 16, bottom: 16, color: "#f88", font: "13px system-ui" }}>{error}</div>}
    </div>
  );
}
