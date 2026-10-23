import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

const TURN_MS = 350;
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Fixed-angle camera for sprite themes (specs/06-themes.md, camera.mode "fixed"): no free
 * rotation; Q / E (or `turnRef.current(±1)`) turn the view 90° around the point in the middle of
 * the screen. The current view direction is kept in camera.userData.viewDir, so fitting the city
 * keeps the angle. Free mode (Blocks) leaves the controls alone.
 */
export default function CameraRig({ fixed, stepDeg = 90, turnRef = null, onTurned = null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const anim = useRef(null); // { from: radians done, total: radians, start }

  useEffect(() => {
    if (!controls) return undefined;
    controls.enableRotate = !fixed;
    if (!fixed) delete camera.userData.viewDir;
    return () => {
      controls.enableRotate = true;
    };
  }, [controls, camera, fixed]);

  useEffect(() => {
    if (!fixed) return undefined;
    const turn = (dir) => {
      if (anim.current) return;
      anim.current = { done: 0, total: (dir * stepDeg * Math.PI) / 180, start: performance.now() };
    };
    if (turnRef) turnRef.current = turn;
    const onKey = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if (e.key === "q" || e.key === "Q") turn(1);
      if (e.key === "e" || e.key === "E") turn(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (turnRef) turnRef.current = null;
    };
  }, [fixed, stepDeg, turnRef]);

  const offset = useRef(new THREE.Vector3());
  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const t = Math.min(1, (performance.now() - a.start) / TURN_MS);
    const e = 1 - (1 - t) * (1 - t);
    const step = a.total * e - a.done;
    a.done += step;
    offset.current.subVectors(camera.position, controls.target).applyAxisAngle(Y, step);
    camera.position.copy(controls.target).add(offset.current);
    camera.lookAt(controls.target);
    controls.update();
    if (t >= 1) {
      anim.current = null;
      camera.userData.viewDir = offset.current.clone().normalize();
      onTurned?.(Math.atan2(offset.current.x, offset.current.z));
    }
  });
  return null;
}
