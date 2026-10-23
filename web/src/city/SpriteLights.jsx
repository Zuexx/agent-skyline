import { useMemo } from "react";
import * as THREE from "three";
import { theme } from "../theme.js";

/**
 * Lights for lit sprite themes: a soft sky fill and a sun that casts shadows. Sprites are drawn lit
 * from the upper left, so the sun stays at the screen's upper left as the camera turns (`facing`,
 * the camera's azimuth). `extent` is the city's half size, for the shadow camera.
 */
export default function SpriteLights({ facing, extent, night = false }) {
  const sun = useMemo(() => {
    // Screen left, seen from azimuth `facing`, is the direction (cos f, 0, -sin f) in world space.
    const left = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const toward = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing)); // toward the camera
    return left.multiplyScalar(1).add(toward.multiplyScalar(0.4)).add(new THREE.Vector3(0, 1.6, 0)).normalize();
  }, [facing]);
  const d = Math.max(20, extent * 1.15);
  return (
    <>
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity * (night ? 0.6 : 0.7)]} />
      <directionalLight
        position={sun.clone().multiplyScalar(d * 2).toArray()}
        intensity={theme.keyIntensity * (night ? 0.45 : 1.4)} // moonlight at night: dim, from the same side
        color={theme.keyLight}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-d}
        shadow-camera-right={d}
        shadow-camera-top={d}
        shadow-camera-bottom={-d}
        shadow-camera-near={0.1}
        shadow-camera-far={d * 5}
      />
    </>
  );
}
