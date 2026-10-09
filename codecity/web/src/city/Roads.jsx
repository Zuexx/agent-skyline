import { useMemo } from "react";
import * as THREE from "three";
import { QuadraticBezierLine } from "@react-three/drei";
import { lit, theme } from "../theme.js";

const MAX_PER_KIND = 60; // a hub file can have hundreds of users; past this the arcs are just noise

// Arcs from the selected building to the files it uses, the files that use it, and the tests
// that use it. Only the selection's roads are drawn: the whole graph at once is a hairball.
// `roofs` maps building path -> [x, roofY, z] in the city group's coordinates.
export default function Roads({ path, deps, roofs }) {
  const arcs = useMemo(() => {
    const from = path && roofs.get(path);
    if (!from || !deps) return [];
    const out = [];
    const add = (list, kind) => {
      for (const p of list.slice(0, MAX_PER_KIND)) {
        const to = roofs.get(p);
        if (!to) continue;
        const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
        const top = Math.max(from[1], to[1]) + 2 + dist * 0.35;
        const mid = [(from[0] + to[0]) / 2, top, (from[2] + to[2]) / 2];
        out.push({ key: `${kind}|${p}`, kind, start: from, end: to, mid });
      }
    };
    add(deps.uses, "uses");
    add(deps.usedBy, "usedBy");
    add(deps.testedBy, "testedBy");
    return out;
  }, [path, deps, roofs]);

  const colors = useMemo(
    () => ({
      uses: new THREE.Color(theme.depUses).multiplyScalar(lit(0.6)),
      usedBy: new THREE.Color(theme.depUsedBy).multiplyScalar(lit(0.6)),
      testedBy: new THREE.Color(theme.added).multiplyScalar(lit(0.6)),
    }),
    []
  );

  return (
    <group>
      {arcs.map((a) => (
        <QuadraticBezierLine
          key={a.key}
          start={a.start}
          end={a.end}
          mid={a.mid}
          color={colors[a.kind]}
          lineWidth={2}
          transparent
          opacity={0.9}
          toneMapped={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
