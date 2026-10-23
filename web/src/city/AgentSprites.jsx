import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { agentColorIndex } from "../lib/activity.js";
import { theme } from "../theme.js";

const MOVE_MS = 900; // walk time to a new building
const FADE_AFTER_MS = 10 * 60 * 1000;
const PITCH_STRETCH = 1 / Math.cos(Math.asin(1 / Math.sqrt(3))); // same as city/looks.js
const IN_FRONT = 0.75; // stand this far in front of the building, toward the camera

// Agents as pixel-art characters (sprite themes with `characters`): each stands in front of the
// building it last touched, walks there when it moves on, and shows its work pose while writing.
// A coloured disc under the feet carries the agent's colour, as the cones' colour did.
// `bases` maps building path -> [x, groundY, z]; `facing` is the camera azimuth (sprites turn to it).
export default function AgentSprites({ agents, bases, characters, facing, ppu = 96, selected = null, onSelect = null }) {
  const now = Date.now();
  const visible = Object.entries(agents ?? {}).filter(([, a]) => {
    if (a.source === "watcher" || !bases.has(a.path)) return false;
    const age = now - Date.parse(a.ts ?? "");
    return Number.isNaN(age) || age < FADE_AFTER_MS;
  });
  return (
    <group>
      {visible.map(([key, a]) => (
        <Character
          key={key}
          agentKey={key}
          character={characters[agentColorIndex(key, characters.length)]}
          target={bases.get(a.path)}
          working={a.kind === "write"}
          facing={facing}
          ppu={ppu}
          selected={key === selected}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function Character({ agentKey, character, target, working, facing, ppu, selected, onSelect }) {
  const group = useRef(null);
  const [pose, setPose] = useState("idle");
  const [hover, setHover] = useState(false);
  const color = theme.agentColors[agentColorIndex(agentKey, theme.agentColors.length)];
  const walk = useRef({ from: null, to: null, start: 0 });
  // In front of the building as seen from the camera.
  const spot = useMemo(() => [target[0] + Math.sin(facing) * IN_FRONT, target[1], target[2] + Math.cos(facing) * IN_FRONT], [target, facing]);
  const spotKey = spot.join(",");

  const materials = useMemo(() => {
    const out = {};
    for (const [name, f] of Object.entries(character.frames)) {
      out[name] = {
        color: new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normal ?? null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 }),
        depth: new THREE.MeshDepthMaterial({ map: f.map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking }),
      };
    }
    return out;
  }, [character]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const st = walk.current;
    if (st.to?.join(",") !== spotKey) {
      st.from = st.to ? g.position.toArray() : spot.slice();
      st.to = spot.slice();
      st.start = performance.now();
    }
    const t = Math.min(1, (performance.now() - st.start) / MOVE_MS);
    g.position.set(THREE.MathUtils.lerp(st.from[0], st.to[0], t), st.to[1], THREE.MathUtils.lerp(st.from[2], st.to[2], t));
    const next = t < 1 ? "walk" : working ? "work" : "idle";
    if (next !== pose) setPose(next);
  });

  const frame = character.frames[pose] ?? character.frames.idle;
  const m = materials[pose] ?? materials.idle;
  const w = frame.w / ppu;
  const h = (frame.h / ppu) * PITCH_STRETCH;
  return (
    <group ref={group} scale={selected ? 1.35 : 1}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} raycast={() => null}>
        <circleGeometry args={[w * 0.55, 20]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.85 : 0.55} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        position={[0, h / 2, 0]}
        rotation-y={facing}
        scale={[w, h, 1]}
        material={m.color}
        customDepthMaterial={m.depth}
        castShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(agentKey);
        }}
      >
        <planeGeometry />
      </mesh>
      {(hover || selected) && (
        <Html position={[0, h + 0.25, 0]} center style={{ pointerEvents: "none" }}>
          <div style={{ background: color, color: "#fff", borderRadius: 4, padding: "1px 6px", fontFamily: "ui-monospace, monospace", fontSize: 11, whiteSpace: "nowrap" }}>
            {agentKey.slice(0, 6)}
          </div>
        </Html>
      )}
    </group>
  );
}
