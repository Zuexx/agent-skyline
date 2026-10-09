import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { lit, theme } from "../theme.js";
import { isLockedPath } from "../lib/zones.js";

const CAP = 0.12;

// Thin caps on building roofs, as a second InstancedMesh so the building colors stay free for
// activity tints. `roofs` maps path -> [x, roofY, z].
// - default: red caps on every building inside a locked zone (`locked` globs);
// - with `paths` and `color`: caps on exactly those buildings (scope warnings use yellow), raised
//   by `lift` so they sit on top of a lock cap instead of inside it.
export default function LockCaps({ buildings, roofs, locked = [], paths = null, color = null, lift = 0 }) {
  const ref = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const capped = useMemo(() => {
    if (paths) return [...paths].filter((p) => roofs.has(p));
    return locked.length ? buildings.map((b) => b.path).filter((p) => isLockedPath(p, locked)) : [];
  }, [buildings, locked, paths, roofs]);
  const tint = useMemo(() => new THREE.Color(color ?? theme.blocked).multiplyScalar(color ? lit(0.8) : 1), [color]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    capped.forEach((p, i) => {
      const [x, y, z] = roofs.get(p);
      dummy.position.set(x, y + lift + CAP / 2, z);
      dummy.scale.set(0.9, CAP, 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = capped.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [capped, roofs, dummy, lift]);

  if (!capped.length) return null;
  return (
    // raycast disabled: caps must not steal hover or clicks from the buildings under them.
    // Keyed by count: an InstancedMesh's capacity is fixed when it is created.
    <instancedMesh key={capped.length} ref={ref} args={[undefined, undefined, capped.length]} frustumCulled={false} raycast={() => null}>
      <boxGeometry />
      <meshLambertMaterial color={tint} toneMapped={false} />
    </instancedMesh>
  );
}
