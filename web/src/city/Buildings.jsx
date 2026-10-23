import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { buildingTransform, HEIGHT_SCALE } from "../lib/geometry.js";
import { buildingTint } from "../lib/activity.js";
import { lit, theme } from "../theme.js";
import { parentDir } from "../lib/parent.js";

// ONE InstancedMesh for every building: unit box geometry, per-instance matrix
// (position + 0.9 x height x 0.9 scale) and per-instance color via setColorAt.
// One draw call keeps it smooth at thousands of buildings.
//
// Color priority per instance: selected > hover > live tint (buildingTint) > base.
// Hover/selection repaint immediately; tints are re-evaluated in useFrame at most
// 4 times per second, and setColorAt is only called for instances whose resolved
// color actually changed.
const TINT_INTERVAL = 0.25; // seconds between tint re-evaluations

// `diff`: Map path -> change while a branch is compared. `onFocus(i)`: double-click a building.
// `look` (city/looks.js): a sprite theme's geometry, material, placement and atlas cells instead of
// the plain box; `facing`: the Y rotation every building gets (billboards turn to the camera).
export default function Buildings({ buildings, districtDepthByPath, selected = null, onSelect, onFocus, activity = null, diff = null, look = null, facing = 0 }) {
  // Where building b goes: the look's own placement, or the box scaled to its line count.
  const place = (b) =>
    look ? look.transform(b, (districtDepthByPath[b.dir ?? parentDir(b.path)] ?? 0) * 0.1) : buildingTransform(b, districtDepthByPath, HEIGHT_SCALE);
  const ref = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const baseColor = useMemo(() => new THREE.Color(theme.building), []);
  // Lit states are pushed above 1.0 so the bloom pass makes them glow; idle stays dark.
  const hoverColor = useMemo(() => new THREE.Color(theme.buildingHover).multiplyScalar(1.4), []);
  const selectedColor = useMemo(() => new THREE.Color(theme.buildingSelected).multiplyScalar(lit()), []);
  const readColor = useMemo(() => new THREE.Color(theme.read).multiplyScalar(lit()), []);
  const writtenColor = useMemo(() => new THREE.Color(theme.written).multiplyScalar(lit(0.75)), []);
  const blockedColor = useMemo(() => new THREE.Color(theme.blocked).multiplyScalar(lit(1.3)), []);
  const addedColor = useMemo(() => new THREE.Color(theme.added).multiplyScalar(lit()), []);
  const modifiedColor = useMemo(() => new THREE.Color(theme.written).multiplyScalar(lit()), []);
  const deletedColor = useMemo(() => new THREE.Color(theme.deleted).multiplyScalar(lit(0.6)), []);
  const [hovered, setHovered] = useState(null);

  // Fresh values for the frame loop without re-subscribing it.
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const diffRef = useRef(diff);
  diffRef.current = diff;

  // Key of the color last applied per instance: "sel" | "hov" | "tint:<kind>" | "base".
  const applied = useRef([]);
  // Last (hovered, selected) pair the immediate repaint has already handled.
  const prev = useRef({ hovered: null, selected: null });

  const colorFor = (key) => {
    switch (key) {
      case "sel": return selectedColor;
      case "hov": return hoverColor;
      case "tint:blocked": return blockedColor;
      case "tint:read": return readColor;
      case "tint:written": return writtenColor;
      case "diff:A": return addedColor;
      case "diff:M":
      case "diff:R": return modifiedColor;
      case "diff:D": return deletedColor;
      default: return baseColor;
    }
  };

  const desiredKey = (i) => {
    if (i === selectedRef.current) return "sel";
    if (i === hoveredRef.current) return "hov";
    const files = activityRef.current?.files;
    const b = buildings[i];
    const tint = files && b ? buildingTint(files[b.path], Date.now()) : null;
    // Live flashes (blocked, read) win; while comparing, the branch's diff replaces the
    // session-long "written" tint, since that is the change being reviewed.
    if (tint === "blocked" || tint === "read") return `tint:${tint}`;
    const change = diffRef.current && b ? diffRef.current.get(b.path) : null;
    if (diffRef.current) return change ? `diff:${change.status}` : "base";
    return tint ? `tint:${tint}` : "base";
  };

  // Diff against the last applied key so setColorAt only fires on real changes.
  // Instances currently not in the base color: the only ones that can need resetting.
  const nonBase = useRef(new Set());
  const applyKey = (mesh, i) => {
    if (i < 0 || i >= mesh.count) return false;
    const key = desiredKey(i);
    if (applied.current[i] === key) return false;
    mesh.setColorAt(i, colorFor(key));
    applied.current[i] = key;
    if (key === "base") nonBase.current.delete(i);
    else nonBase.current.add(i);
    return true;
  };

  // Which instances can be tinted at all: files with activity or a diff entry.
  const indexByPath = useMemo(() => new Map((buildings ?? []).map((b, i) => [b.path, i])), [buildings]);

  const repaint = (indices) => {
    const mesh = ref.current;
    if (!mesh) return;
    let changed = false;
    for (const i of indices) if (i != null && applyKey(mesh, i)) changed = true;
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Placement. When the view changes, the same buildings (same order, same files) fly from their
  // old spots to the new ones; a first placement or a different building set just snaps.
  const placed = useRef(null); // [{ p: [x,y,z], s: [x,y,z] }] currently shown
  const flight = useRef(null); // { from, to, start }

  const writeMatrices = (mesh, list) => {
    list.forEach((t, i) => {
      dummy.position.set(t.p[0], t.p[1], t.p[2]);
      dummy.scale.set(t.s[0], t.s[1], t.s[2]);
      dummy.rotation.set(0, facing, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const target = (buildings ?? []).map((b) => {
      const { position, scale } = place(b);
      return { p: position, s: scale };
    });
    if (look) mesh.geometry.setAttribute("aRect", new THREE.InstancedBufferAttribute(Float32Array.from(look.rects.flat()), 4));
    const sameSet = placed.current && placed.current.length === target.length && mesh.count === target.length;
    // Only a turn (same spots, new facing): no flight, just rewrite the matrices.
    const moved = sameSet && target.some((t, i) => t.p.some((v, k) => v !== placed.current[i].p[k]) || t.s.some((v, k) => v !== placed.current[i].s[k]));
    if (sameSet && !moved) {
      writeMatrices(mesh, target);
    } else if (sameSet) {
      flight.current = { from: placed.current, to: target, start: performance.now() };
    } else {
      writeMatrices(mesh, target);
      placed.current = target;
      flight.current = null;
      (buildings ?? []).forEach((_, i) => mesh.setColorAt(i, baseColor));
      mesh.count = buildings?.length ?? 0;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      applied.current = new Array(buildings?.length ?? 0).fill("base");
      nonBase.current = new Set();
      prev.current = { hovered: null, selected: null };
      setHovered(null);
    }
    mesh.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, districtDepthByPath, dummy, baseColor, look, facing]);

  const FLIGHT_MS = 1100;
  useFrame(() => {
    const f = flight.current;
    const mesh = ref.current;
    if (!f || !mesh) return;
    const t = Math.min(1, (performance.now() - f.start) / FLIGHT_MS);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out
    // Lift buildings while they travel, so the regrouping reads as motion rather than a cut.
    const lift = Math.sin(Math.PI * e) * 3;
    const now = f.to.map((to, i) => {
      const from = f.from[i];
      const lerp = (a, b) => a + (b - a) * e;
      return {
        p: [lerp(from.p[0], to.p[0]), lerp(from.p[1], to.p[1]) + lift, lerp(from.p[2], to.p[2])],
        s: [to.s[0], lerp(from.s[1], to.s[1]), to.s[2]],
      };
    });
    writeMatrices(mesh, now);
    if (t >= 1) {
      writeMatrices(mesh, f.to);
      placed.current = f.to;
      flight.current = null;
      mesh.computeBoundingSphere();
    }
  });

  // Hover/selection repaints immediately (tints wait for the frame loop below),
  // touching only the instances whose hover or selection state changed.
  useLayoutEffect(() => {
    const p = prev.current;
    repaint(new Set([p.hovered, hovered, p.selected, selected]));
    prev.current = { hovered, selected };
  }, [hovered, selected, buildings]);

  // Live tints: re-evaluate at most 4 times per second.
  const tintClock = useRef(0);
  useFrame((_, delta) => {
    tintClock.current += delta;
    if (tintClock.current < TINT_INTERVAL) return;
    tintClock.current = 0;
    const mesh = ref.current;
    if (!mesh || !mesh.count) return;
    // Visit only candidates, not every building: with 20k buildings a full sweep four times a
    // second was a large share of the frame budget.
    const todo = new Set(nonBase.current);
    for (const p of Object.keys(activityRef.current?.files ?? {})) {
      const i = indexByPath.get(p);
      if (i != null) todo.add(i);
    }
    for (const p of diffRef.current?.keys() ?? []) {
      const i = indexByPath.get(p);
      if (i != null) todo.add(i);
    }
    let changed = false;
    for (const i of todo) if (applyKey(mesh, i)) changed = true;
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const label = useMemo(() => {
    if (hovered == null || !buildings?.[hovered]) return null;
    const b = buildings[hovered];
    const { position, scale } = place(b);
    return { path: b.path, position: [position[0], position[1] + scale[1] / 2 + 0.4, position[2]] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, buildings, districtDepthByPath, look]);

  if (!buildings?.length) return null;

  return (
    <group>
      <instancedMesh
        key={look ? "look" : "box"}
        ref={ref}
        args={[look?.geometry, look?.material, buildings.length]}
        castShadow={Boolean(look?.depthMaterial)}
        receiveShadow={Boolean(look?.depthMaterial)}
        customDepthMaterial={look?.depthMaterial ?? undefined}
        frustumCulled={false}
        onPointerMove={(e) => {
          e.stopPropagation(); // nearest building wins over anything behind it
          if (e.instanceId !== hovered) setHovered(e.instanceId);
        }}
        onPointerOut={() => setHovered(null)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(e.instanceId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFocus?.(e.instanceId);
        }}
      >
        {/* White base material: the per-instance colors show through unchanged.
            toneMapped off so lit colors above 1.0 reach the bloom pass intact. */}
        {!look && <boxGeometry />}
        {!look && <meshLambertMaterial toneMapped={false} />}
      </instancedMesh>
      {label && (
        <Html position={label.position} center zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: theme.panelBg,
              border: `1px solid ${theme.panelBorder}`,
              borderRadius: 6,
              color: theme.text,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 12,
              padding: "3px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {label.path}
          </div>
        </Html>
      )}
    </group>
  );
}
