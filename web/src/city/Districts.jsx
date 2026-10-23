import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { districtColor, theme } from "../theme.js";
import { districtGlob } from "../lib/zones.js";

const SLAB = 0.1;

// Flat slabs, one per district, drawn as ONE InstancedMesh: a large repo has thousands of folders,
// and one mesh per folder cost a draw call and a React element each (a 20k-file repo fell to a
// couple of frames per second). A district at depth `d` sits on base = d * SLAB so nested districts
// stack on their parent; color steps with depth. Locked districts use the locked color, districts in
// the declared task scope the scope color. While `editing` (zone or scope mode), a click toggles the
// topmost hit — the deepest slab, since it sits highest.
function Districts({ districts, locked = [], allowed = [], editing = false, onToggle }) {
  const ref = useRef(null);
  const list = useMemo(() => (districts ?? []).filter((d) => d.w > 0 && d.d > 0), [districts]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    list.forEach((d, i) => {
      dummy.position.set(d.x + d.w / 2, d.depth * SLAB + SLAB / 2, d.z + d.d / 2);
      dummy.scale.set(d.w, SLAB, d.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [list, dummy]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const lockedSet = new Set(locked);
    const allowedSet = new Set(allowed);
    const c = new THREE.Color();
    list.forEach((d, i) => {
      const glob = districtGlob(d.path);
      c.set(lockedSet.has(glob) ? theme.locked : allowedSet.has(glob) ? theme.scope : districtColor(d.depth));
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [list, locked, allowed]);

  if (!list.length) return null;
  return (
    <instancedMesh
      key={list.length}
      ref={ref}
      args={[undefined, undefined, list.length]}
      frustumCulled={false}
      receiveShadow
      onClick={
        editing
          ? (e) => {
              const d = list[e.instanceId];
              if (!d?.path) return; // the root cannot be locked or scoped
              e.stopPropagation(); // nested slabs overlap; only the topmost one toggles
              onToggle?.(d.path);
            }
          : undefined
      }
    >
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

export default memo(Districts);
