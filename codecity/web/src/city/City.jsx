import { useMemo } from "react";
import Districts from "./Districts.jsx";
import Buildings from "./Buildings.jsx";
import Agents from "./Agents.jsx";
import LockCaps from "./LockCaps.jsx";
import Pulses from "./Pulses.jsx";
import DistrictLabels from "./DistrictLabels.jsx";
import { buildingTransform, HEIGHT_SCALE } from "../lib/geometry.js";
import { theme } from "../theme.js";

// The whole city, centered on the origin: raw coordinates are offset by
// (-width/2, 0, -depth/2) so the camera can look at (0, 0, 0).
// `city` is the current view (see lib/views.js): buildings carry `dir`, their district in this view.
export default function City({
  city,
  selected = null,
  onSelect,
  onFocus,
  activity = null,
  diff = null,
  ping = null,
  locked = [],
  allowed = [],
  editing = false,
  onToggleDistrict,
  warnPaths = null,
}) {
  const districtDepthByPath = useMemo(
    () => Object.fromEntries((city.districts ?? []).map((d) => [d.path, d.depth])),
    [city]
  );

  // Roof and base center of every building: agent markers hover over roofs, pulses ring the base.
  const { roofs, bases } = useMemo(() => {
    const roofs = new Map();
    const bases = new Map();
    for (const b of city.buildings ?? []) {
      const { position, scale } = buildingTransform(b, districtDepthByPath, HEIGHT_SCALE);
      roofs.set(b.path, [position[0], position[1] + scale[1] / 2, position[2]]);
      bases.set(b.path, [position[0], position[1] - scale[1] / 2, position[2]]);
    }
    return { roofs, bases };
  }, [city, districtDepthByPath]);

  // Files per district, counting everything below it, for the name signs.
  const fileCounts = useMemo(() => {
    const m = new Map();
    for (const b of city.buildings ?? []) {
      let d = b.dir ?? "";
      while (d) {
        m.set(d, (m.get(d) ?? 0) + 1);
        const i = d.lastIndexOf("/");
        d = i < 0 ? "" : d.slice(0, i);
      }
    }
    return m;
  }, [city]);

  // A modest apron around the root district, not a horizon-filling plane.
  const GROUND_MARGIN = 6;

  return (
    <group position={[-(Number(city.width) || 0) / 2, 0, -(Number(city.depth) || 0) / 2]}>
      <mesh rotation-x={-Math.PI / 2} position={[(Number(city.width) || 0) / 2, 0, (Number(city.depth) || 0) / 2]}>
        <planeGeometry args={[(Number(city.width) || 0) + GROUND_MARGIN * 2, (Number(city.depth) || 0) + GROUND_MARGIN * 2]} />
        <meshLambertMaterial color={theme.ground} />
      </mesh>
      <Districts
        districts={city.districts ?? []}
        locked={locked}
        allowed={allowed}
        editing={editing}
        onToggle={onToggleDistrict}
      />
      <LockCaps buildings={city.buildings ?? []} roofs={roofs} locked={locked} />
      {warnPaths?.size > 0 && <LockCaps buildings={city.buildings ?? []} roofs={roofs} paths={warnPaths} color={theme.warn} lift={0.14} />}
      <Buildings
        buildings={city.buildings ?? []}
        districtDepthByPath={districtDepthByPath}
        selected={selected}
        onSelect={onSelect}
        onFocus={onFocus}
        activity={activity}
        diff={diff}
      />
      <Agents agents={activity?.agents} roofs={roofs} />
      <Pulses feed={activity?.feed} bases={bases} ping={ping} />
      <DistrictLabels districts={city.districts} fileCounts={fileCounts} grouped={city.grouped} />
    </group>
  );
}
