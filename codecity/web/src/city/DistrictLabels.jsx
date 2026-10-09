import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

// Name signs on districts. Zoomed out, only the top level is labeled; zooming in reveals one more
// level at a time, so the city never turns into a wall of text. Each sign sits on the district's
// far corner (smallest x and z), which is its top tip in the isometric view.
//
// The signs are plain DOM in one overlay (ui/LabelLayer.jsx), not drei <Html>: <Html> mounts a
// separate React root per sign, and on a big repo (VS Code: 4,600 districts) zooming mounted and
// unmounted so many roots at once that React threw ("removeChild ... not a child"). Here the 3D
// side only decides which signs show and, every frame, writes their screen positions straight
// onto the overlay's elements through `bus`.
const LEVEL_STEPS = [1, 1.8, 3.2, 5]; // zoom / fitZoom needed to show depth 1, 2, 3, 4
const MIN_PX = 70; // smallest district side, in screen pixels (ortho zoom = pixels per unit), worth a sign

/** Shared between the scene and the overlay: the overlay registers setLabels and its elements. */
export function createLabelBus() {
  return { setLabels: null, elements: new Map() };
}

export default function DistrictLabels({ districts, fileCounts, bus }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [maxDepth, setMaxDepth] = useState(1);
  const [zoom, setZoom] = useState(camera.zoom);
  const clock = useRef(0);
  const anchor = useRef(null); // a group inside the city, so local -> world includes the city offset
  const v = useMemo(() => new THREE.Vector3(), []);

  const shown = useMemo(
    // A sign needs room: districts narrower than MIN_PX on screen stay unlabeled until zoomed in,
    // so a cluster of tiny folders (.config, .github, ...) does not pile its names on top of each other.
    () => (districts ?? []).filter((d) => d.depth >= 1 && d.depth <= maxDepth && Math.min(d.w, d.d) * zoom >= MIN_PX),
    [districts, maxDepth, zoom]
  );

  useEffect(() => {
    bus.setLabels?.(shown.map((d) => ({ key: d.path, path: d.path, depth: d.depth, count: fileCounts?.get(d.path) ?? null })));
  }, [shown, fileCounts, bus]);
  useEffect(() => () => bus.setLabels?.([]), [bus]);

  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current >= 0.2) {
      clock.current = 0;
      const rel = camera.zoom / (camera.userData.fitZoom || camera.zoom);
      let d = 0;
      while (d < LEVEL_STEPS.length && rel >= LEVEL_STEPS[d] * 0.999) d++;
      if (d !== maxDepth) setMaxDepth(d);
      if (Math.abs(camera.zoom - zoom) > zoom * 0.1) setZoom(camera.zoom);
    }
    const group = anchor.current;
    if (!group) return;
    for (const d of shown) {
      const el = bus.elements.get(d.path);
      if (!el) continue;
      v.set(d.x + 0.6, d.depth * 0.1 + 0.15, d.z + 0.6);
      group.localToWorld(v);
      v.project(camera);
      if (v.z < -1 || v.z > 1) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    }
  });

  return <group ref={anchor} />;
}
