import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

// Only mounted with `?demo` in the URL. Lets a scripted recording find buildings on screen:
// window.__agentSkylineDemo.screenOf(path) -> { x, y } in CSS pixels (top of the building), or null.
export default function DemoBridge({ worldOf }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    window.__agentSkylineDemo = {
      screenOf(path) {
        const w = worldOf(path);
        if (!w) return null;
        const v = new THREE.Vector3(...w).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
    };
    return () => {
      delete window.__agentSkylineDemo;
    };
  }, [camera, size, worldOf]);
  return null;
}
