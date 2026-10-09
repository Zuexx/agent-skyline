import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { lit, theme } from "../theme.js";

const LIFE_MS = { read: 1100, write: 1600, blocked: 2200, ping: 1400 };
const MAX_SCALE = { read: 4, write: 6, blocked: 9, ping: 7 };
const MAX_LIVE = 60; // cap simultaneous rings
const FRESH_MS = 5000; // ignore replayed history older than this, or a reconnect fires 200 rings

const eventKey = (ev) => `${ev.ts}|${ev.session}|${ev.kind}|${(ev.paths ?? []).join(",")}`;

// An expanding, fading ring on the ground under a building for every fresh read / write /
// blocked event. `bases` maps building path -> [x, baseY, z] in the city group's coordinates.
// `ping` = { path, nonce }: a one-off ring to show where the camera just flew.
export default function Pulses({ feed, bases, ping }) {
  const seen = useRef(new Set());
  const [rings, setRings] = useState([]);

  useEffect(() => {
    const at = ping && bases.get(ping.path);
    if (!at) return;
    setRings((r) => [{ id: `ping|${ping.nonce}`, kind: "ping", at, born: performance.now() }, ...r].slice(0, MAX_LIVE));
  }, [ping, bases]);

  useEffect(() => {
    const now = Date.now();
    const fresh = [];
    for (const ev of feed ?? []) {
      const key = eventKey(ev);
      if (seen.current.has(key)) break; // feed is newest-first; the rest was handled before
      seen.current.add(key);
      if (!LIFE_MS[ev.kind]) continue;
      const age = now - Date.parse(ev.ts ?? "");
      if (!(age < FRESH_MS)) continue;
      for (const p of ev.paths ?? []) {
        const at = bases.get(p);
        if (at) fresh.push({ id: `${key}|${p}`, kind: ev.kind, at, born: performance.now() });
      }
    }
    if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-500));
    if (fresh.length) setRings((r) => [...fresh, ...r].slice(0, MAX_LIVE));
  }, [feed, bases]);

  return (
    <group>
      {rings.map((r) => (
        <Ring key={r.id} ring={r} onDone={() => setRings((all) => all.filter((x) => x.id !== r.id))} />
      ))}
    </group>
  );
}

function Ring({ ring, onDone }) {
  const mesh = useRef(null);
  const color = useRef(
    new THREE.Color({ read: theme.read, write: theme.written, blocked: theme.blocked, ping: theme.ping }[ring.kind]).multiplyScalar(lit())
  );
  const done = useRef(false);

  useFrame(() => {
    const m = mesh.current;
    if (!m || done.current) return;
    const t = (performance.now() - ring.born) / LIFE_MS[ring.kind];
    if (t >= 1) {
      done.current = true;
      onDone();
      return;
    }
    const s = 0.6 + (MAX_SCALE[ring.kind] - 0.6) * (1 - (1 - t) * (1 - t)); // ease-out
    m.scale.set(s, s, s);
    m.material.opacity = 1 - t;
  });

  return (
    <mesh ref={mesh} position={[ring.at[0], ring.at[1] + 0.06, ring.at[2]]} rotation-x={-Math.PI / 2} raycast={() => null}>
      <ringGeometry args={[0.8, 1, 48]} />
      <meshBasicMaterial color={color.current} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
