import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect, useRef } from "react";

const ZOOM_IN = 2.6; // follow zoom, relative to the fit-to-city zoom
const EASE = 3; // higher = snappier

// While enabled, glide the camera so `target` (world position of the latest event) sits in the
// middle of the screen, and zoom in. Pans the controls' target and the camera by the same offset,
// so the isometric angle never changes.
// `focus` = { target, nonce }: a one-off flight (feed click, double-click) that stops on arrival.
export default function CameraFollow({ target, enabled, focus }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const flight = useRef(null);
  useEffect(() => {
    if (focus?.target) flight.current = focus.target;
  }, [focus]);
  // Grabbing the map cancels a flight in progress.
  useEffect(() => {
    if (!controls) return undefined;
    const stop = () => (flight.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, delta) => {
    if (flight.current && controls) {
      const done = glide(camera, controls, flight.current, delta);
      if (done) flight.current = null;
      return;
    }
    if (!enabled || !target || !controls) return;
    const k = 1 - Math.exp(-EASE * delta);
    const goal = new THREE.Vector3(target[0], 0, target[2]);
    const step = goal.sub(controls.target).multiplyScalar(k);
    controls.target.add(step);
    camera.position.add(step);
    const fit = camera.userData.fitZoom;
    if (fit) {
      camera.zoom += (fit * ZOOM_IN - camera.zoom) * k;
      camera.updateProjectionMatrix();
    }
    controls.update();
  });

  return null;
}

// One easing step toward `target` (pan + zoom in). Returns true once arrived.
function glide(camera, controls, target, delta) {
  const k = 1 - Math.exp(-EASE * 1.6 * delta);
  const goal = new THREE.Vector3(target[0], 0, target[2]);
  const step = goal.clone().sub(controls.target).multiplyScalar(k);
  controls.target.add(step);
  camera.position.add(step);
  const fit = camera.userData.fitZoom;
  const want = fit ? fit * ZOOM_IN : camera.zoom;
  camera.zoom += (want - camera.zoom) * k;
  camera.updateProjectionMatrix();
  controls.update();
  return goal.distanceTo(controls.target) < 0.05 && Math.abs(want - camera.zoom) < want * 0.01;
}
