import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { agentColorIndex } from "../lib/activity.js";
import { lit, theme } from "../theme.js";

const FLOAT = 5.5; // marker height above the building's roof (a light beam fills the gap)
const BOB = 0.3; // bob amplitude
const MOVE_MS = 300; // glide time to a new building
const FADE_AFTER_MS = 10 * 60 * 1000; // quiet agents fade out, then disappear
const FADE_MS = 60 * 1000;

// One marker per agent whose last event names a known building.
// `roofs` maps building path -> [x, roofY, z] in the city group's coordinates.
export default function Agents({ agents, roofs }) {
  const now = Date.now();
  const visible = Object.entries(agents ?? {}).filter(([, a]) => {
    if (a.source === "watcher") return false; // no author to place: the watcher has no marker
    if (!roofs.has(a.path)) return false;
    const age = now - Date.parse(a.ts ?? "");
    return Number.isNaN(age) || age < FADE_AFTER_MS + FADE_MS;
  });
  return (
    <group>
      {visible.map(([key, a]) => (
        <AgentMarker key={key} agentKey={key} target={roofs.get(a.path)} ts={a.ts} source={a.source} />
      ))}
    </group>
  );
}

// Claude Code is an upside-down cone; any other agent kind is a diamond, so kinds read apart.
function AgentMarker({ agentKey, target, ts, source }) {
  const isClaude = !source || source === "claude-code";
  const group = useRef(null);
  const material = useRef(null);
  const [hover, setHover] = useState(false);
  const color = theme.agentColors[agentColorIndex(agentKey, theme.agentColors.length)];
  const glow = useMemo(() => new THREE.Color(color).multiplyScalar(lit()), [color]);
  const beamMaterial = useRef(null);
  // Glide state: from where the marker was to the new target, over MOVE_MS.
  const glide = useRef({ from: null, to: null, start: 0 });
  const targetKey = target.join(",");
  const phase = useMemo(() => agentColorIndex(agentKey, 1000) / 1000 * Math.PI * 2, [agentKey]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const st = glide.current;
    if (st.to?.join(",") !== targetKey) {
      st.from = st.to ? g.position.toArray() : target.slice();
      st.to = target.slice();
      st.start = performance.now();
    }
    const t = Math.min(1, (performance.now() - st.start) / MOVE_MS);
    const e = 1 - (1 - t) * (1 - t); // ease-out
    const bob = Math.sin(clock.elapsedTime * 2.2 + phase) * BOB;
    g.position.set(
      THREE.MathUtils.lerp(st.from[0], st.to[0], e),
      THREE.MathUtils.lerp(st.from[1], st.to[1], e) + FLOAT + bob,
      THREE.MathUtils.lerp(st.from[2], st.to[2], e)
    );
    if (material.current) {
      const age = Date.now() - Date.parse(ts ?? "");
      const fade = Number.isNaN(age) ? 1 : 1 - Math.min(1, Math.max(0, age - FADE_AFTER_MS) / FADE_MS);
      material.current.opacity = fade;
      if (beamMaterial.current) beamMaterial.current.opacity = 0.55 * fade;
    }
  });

  return (
    <group ref={group}>
      {/* Upside-down cone: the tip points at the building being worked on. */}
      <mesh
        rotation-x={isClaude ? Math.PI : 0}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        {/* Sized to read at the fit-to-city zoom, where a building footprint is only a few pixels. */}
        {isClaude ? <coneGeometry args={[1.2, 2.6, 20]} /> : <octahedronGeometry args={[1.3, 0]} />}
        <meshBasicMaterial ref={material} color={glow} transparent toneMapped={false} />
      </mesh>
      {/* Light beam from the cone's tip down to the roof the agent is working on. */}
      <mesh position={[0, -(FLOAT - 1.3) / 2 - 1.3, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.12, 0.35, FLOAT - 1.3, 12, 1, true]} />
        <meshBasicMaterial ref={beamMaterial} color={glow} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>      {hover && (
        <Html position={[0, 2, 0]} center style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: color,
              color: "#fff",
              borderRadius: 4,
              padding: "1px 6px",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 11,
            }}
          >
            {agentKey.slice(0, 6)}
          </div>
        </Html>
      )}
    </group>
  );
}
