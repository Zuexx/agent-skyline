import { districtColor, theme } from "../theme.js";
import { districtGlob } from "../lib/zones.js";

// Flat slabs, one per district. A district at depth `d` sits on base = d * 0.1 so nested
// districts stack on top of their parent; color steps with depth.
// Locked districts are drawn in the locked color, districts in the declared task scope in the
// scope color. In zone or scope mode (`editing`), a click toggles the clicked (topmost, i.e.
// deepest) district through `onToggle`.
export default function Districts({ districts, locked = [], allowed = [], editing = false, onToggle }) {
  return (
    <group>
      {(districts ?? []).map((d) => {
        const glob = districtGlob(d.path);
        const color = locked.includes(glob) ? theme.locked : allowed.includes(glob) ? theme.scope : districtColor(d.depth);
        return (
          <mesh
            key={d.path}
            position={[d.x + d.w / 2, d.depth * 0.1 + 0.05, d.z + d.d / 2]}
            onClick={
              editing && d.path
                ? (e) => {
                    e.stopPropagation(); // nested slabs overlap; only the topmost one toggles
                    onToggle?.(d.path);
                  }
                : undefined
            }
          >
            <boxGeometry args={[d.w, 0.1, d.d]} />
            <meshLambertMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}
