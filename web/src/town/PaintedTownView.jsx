import { useEffect, useMemo, useRef, useState } from "react";
import { createPaintedTown } from "./paintedTown.js";
import { townState } from "./townState.js";
import { useNow } from "../lib/useNow.js";

/**
 * The painted town (pack renderer "painted", specs/09–10) in place of the 3D city: fills its
 * parent, follows the page's live `activity`. The renderer is rebuilt when the pack or the variant
 * changes; agent state is pushed in without rebuilding.
 */
export default function PaintedTownView({ pack, variant, activity, agentSeq, view = "pano" }) {
  const box = useRef(null);
  const town = useRef(null);
  const [error, setError] = useState(null);
  const now = useNow(10_000); // quiet agents go idle even without new events
  const buildingIds = useMemo(() => (pack.variants[variant]?.buildings ?? []).map((b) => b.id), [pack, variant]);
  const state = useMemo(() => townState(activity, agentSeq, buildingIds, now), [activity, agentSeq, buildingIds, now]);
  const stateRef = useRef(state);
  stateRef.current = state;

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
    })
      .then((t) => {
        if (cancelled) return t.dispose();
        made = town.current = t;
        t.setState(stateRef.current); // whatever arrived while the pack was loading
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      made?.dispose();
      town.current = null;
    };
  }, [pack, variant, view]);

  useEffect(() => {
    town.current?.setState(state);
  }, [state]);

  return (
    <div ref={box} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {error && <div style={{ position: "absolute", left: 16, bottom: 16, color: "#f88", font: "13px system-ui" }}>{error}</div>}
    </div>
  );
}
