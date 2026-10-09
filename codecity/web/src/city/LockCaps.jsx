import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { theme } from "../theme.js";
import { isLockedPath } from "../lib/zones.js";

const CAP = 0.12;

// A thin red cap on every building inside a locked zone, as a second InstancedMesh so the
// building colors stay free for activity tints. `roofs` maps path -> [x, roofY, z].
export default function LockCaps({ buildings, roofs, locked }) {
  const ref = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lockedPaths = useMemo(
    () => (locked.length ? buildings.map((b) => b.path).filter((p) => isLockedPath(p, locked)) : []),
    [buildings, locked]
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    lockedPaths.forEach((p, i) => {
      const [x, y, z] = roofs.get(p);
      dummy.position.set(x, y + CAP / 2, z);
      dummy.scale.set(0.9, CAP, 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = lockedPaths.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [lockedPaths, roofs, dummy]);

  if (!lockedPaths.length) return null;
  return (
    // raycast disabled: caps must not steal hover or clicks from the buildings under them.
    <instancedMesh ref={ref} args={[undefined, undefined, lockedPaths.length]} frustumCulled={false} raycast={() => null}>
      <boxGeometry />
      <meshLambertMaterial color={theme.blocked} />
    </instancedMesh>
  );
}
