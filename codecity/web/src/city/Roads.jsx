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
    const add = (list, kind, unusedSet) => {
      for (const p of list.slice(0, MAX_PER_KIND)) {
        const to = roofs.get(p);
        if (!to) continue;
        const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
        const top = Math.max(from[1], to[1]) + 2 + dist * 0.35;
        const mid = [(from[0] + to[0]) / 2, top, (from[2] + to[2]) / 2];
        // An import whose names are never used: drawn grey and dashed, still a road (it loads).
        const unused = Boolean(unusedSet?.has(p));
        out.push({ key: `${kind}|${p}`, kind: unused ? "unused" : kind, start: from, end: to, mid, dashed: unused });
      }
    };
    add(deps.uses, "uses", deps.unusedUses);
    add(deps.usedBy, "usedBy", deps.unusedBy);
    add(deps.testedBy, "testedBy", deps.unusedBy);
    return out;
  }, [path, deps, roofs]);

  const colors = useMemo(
    () => ({
      uses: new THREE.Color(theme.depUses).multiplyScalar(lit(0.6)),
      usedBy: new THREE.Color(theme.depUsedBy).multiplyScalar(lit(0.6)),
      testedBy: new THREE.Color(theme.added).multiplyScalar(lit(0.6)),
      unused: new THREE.Color(theme.muted),
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
          dashed={a.dashed}
          dashSize={1.2}
          gapSize={0.8}
          transparent
          opacity={0.9}
          toneMapped={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
